#!/usr/bin/env python3
"""Convert staged hierarchy JSON to PSI116 XML without dropping fittings."""
from __future__ import annotations
import argparse, json, math, re
from pathlib import Path
from xml.sax.saxutils import escape

BORE_KEYS = ('HBOR','TBOR','ABORE','LBORE','DTXR','BORE','NBORE','DBOR')
TYPE_RULES = (
    (re.compile(r'WELDOLET|SOCKOLET|THREDOLET|SWEEPOLET|\bOLET\b', re.I), 'OLET'),
    (re.compile(r'\bVALV(E)?\b', re.I), 'VALV'),
    (re.compile(r'\bFLAN(GE)?\b', re.I), 'FLAN'),
    (re.compile(r'\bGASK(ET)?\b', re.I), 'GASK'),
    (re.compile(r'\b(ELBO(W)?|BEND)\b', re.I), 'ELBO'),
    (re.compile(r'\bTEE\b', re.I), 'TEE'),
    (re.compile(r'\bREDU(CER)?\b', re.I), 'REDU'),
    (re.compile(r'\b(ATTA|SUPP|SUPPORT)\b', re.I), 'ATTA'),
    (re.compile(r'\b(PIPE|TUBI)\b', re.I), 'PIPE'),
)


def txt(v): return '' if v is None else str(v)
def x(v): return escape(txt(v), {'"': '&quot;'})
def finite(v, default=0.0):
    try:
        n = float(v)
        return n if math.isfinite(n) else default
    except Exception:
        return default
def nfmt(v, dec=3):
    s = f"{finite(v):.{dec}f}".rstrip('0').rstrip('.')
    return s or '0'
def mm(v):
    m = re.search(r'-?\d+(?:\.\d+)?', txt(v).replace('mm', ' ').replace('MM', ' '))
    return float(m.group(0)) if m else None

def attrs(o):
    out = {}
    if isinstance(o, dict):
        for k in ('attributes','attrs','attr'):
            if isinstance(o.get(k), dict): out.update(o[k])
    return out

def first(a, keys):
    for k in keys:
        if k in a and txt(a[k]).strip(): return a[k]
    return ''

def point(v):
    if v in (None, ''): return None
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        p = tuple(finite(v[i], float('nan')) for i in range(3))
        return p if all(math.isfinite(c) for c in p) else None
    if isinstance(v, dict):
        p = (finite(v.get('x', v.get('X')), float('nan')), finite(v.get('y', v.get('Y')), float('nan')), finite(v.get('z', v.get('Z')), float('nan')))
        return p if all(math.isfinite(c) for c in p) else None
    vals = [float(q) for q in re.findall(r'-?\d+(?:\.\d+)?', txt(v))]
    return tuple(vals[:3]) if len(vals) >= 3 else None

def getp(o, a, keys):
    for k in keys:
        p = point(a.get(k) if k in a else o.get(k) if isinstance(o, dict) else None)
        if p: return p
    return None

def points(o):
    a = attrs(o)
    return {
        'apos': getp(o,a,('APOS','A_POS','EP1','END1','START','START_POINT','POS_START')),
        'lpos': getp(o,a,('LPOS','L_POS','EP2','END2','END','END_POINT','POS_END')),
        'pos': getp(o,a,('POS','POSITION','COORDS','CO_ORDS','CO_ORD','POSS')),
        'cpos': getp(o,a,('CPOS','CP','CENTER','CENTRE','CENTER_POINT','CENTRE_POINT')),
        'bpos': getp(o,a,('BPOS','BP','BRANCH_POINT','BPOS1','TEE_POINT')),
    }

def ctype(o):
    a = attrs(o)
    s = ' '.join(txt(v) for v in (o.get('type') if isinstance(o,dict) else '', o.get('kind') if isinstance(o,dict) else '', o.get('name') if isinstance(o,dict) else '', a.get('TYPE'), a.get('STYP'), a.get('SPRE'), a.get('PTYPE'), a.get('DETAIL')))
    for rx, t in TYPE_RULES:
        if rx.search(s): return t
    return 'UNKNOWN'

def bore(a, default):
    for k in BORE_KEYS:
        v = mm(a.get(k))
        if v and v > 0: return v
    return default

def dist(a,b): return math.sqrt(sum((a[i]-b[i])**2 for i in range(3))) if a and b else 0.0

def bend_radius(o, ps):
    a = attrs(o)
    v = mm(first(a, ('BENDRADIUS','BEND_RADIUS','BRAD','RADI','RADIUS')))
    if v and v > 0: return v
    c = ps.get('cpos') or ps.get('pos')
    return min(dist(c, ps.get('apos')), dist(c, ps.get('lpos'))) if c and ps.get('apos') and ps.get('lpos') else 0.0

def reducer_angle(o):
    a = attrs(o)
    v = mm(first(a, ('ALPHAANGLE','ALPHA_ANGLE','ANGLE','REDUCERANGLE')))
    return v if v is not None else 1.0

def branch_list(data):
    roots = data if isinstance(data, list) else [data]
    out = []
    for e in roots:
        if not isinstance(e, dict): continue
        if isinstance(e.get('children'), list): out.append(e)
        elif isinstance(e.get('items'), list):
            d = dict(e); d['children'] = e['items']; out.append(d)
        elif isinstance(e.get('branches'), list): out.extend(e['branches'])
    return out

class Ctx:
    def __init__(self, opt):
        self.node = max(1, int(finite(opt.node_start, 10)))
        self.step = max(1, int(finite(opt.node_step, 10)))
        self.ref = 1
        self.default_diameter = max(0.001, finite(opt.default_diameter, 100))
        self.default_wall = max(0.0, finite(opt.default_wall_thickness, 0.01))
        self.default_corr = max(0.0, finite(opt.default_corrosion_allowance, 0))
        self.default_insu = max(0.0, finite(opt.default_insulation_thickness, 0))
    def next(self):
        n = self.node; self.node += self.step; return n
    def autoref(self):
        r = f'AUTO-{self.ref}'; self.ref += 1; return r

def make_node(o, typ, ep, p, ctx, number=-1, bend_radius=0, bend_type=None, alpha=None):
    a = attrs(o)
    return dict(
        number=number,
        name=txt(first(a, ('NAME','TAG','TAGNO','ITEMCODE','PARTNO')) or (o.get('name') if isinstance(o, dict) else '')),
        endpoint=ep, ctype=typ,
        ref=txt(first(a, ('COMPONENTREFNO','REFNO','REF','DBREF','CA97','CA98')) or (o.get('id') if isinstance(o, dict) else '') or ctx.autoref()),
        conn=txt(first(a, ('CONNECTIONTYPE','CONN','CONNECTION','CREF','CTYP'))),
        od=bore(a, ctx.default_diameter),
        wall=mm(a.get('WTHK') or a.get('WALLTHK') or a.get('WALL_THICKNESS')) or ctx.default_wall,
        corr=mm(a.get('CORA') or a.get('CORROSIONALLOWANCE')) or ctx.default_corr,
        insu=mm(a.get('INSU') or a.get('INSULATIONTHICKNESS')) or ctx.default_insu,
        pos=p, br=bend_radius, bt=bend_type, alpha=alpha,
        sif=finite(a.get('SIF'), 0), weight=finite(a.get('WEIG') or a.get('WEIGHT'), 0)
    )

def expand(o, ctx):
    typ = ctype(o); ps = points(o); base = ps['pos'] or ps['cpos'] or ps['apos'] or ps['lpos'] or ps['bpos']
    if typ == 'UNKNOWN' or not base: return []
    out = []
    if typ == 'ELBO':
        r = bend_radius(o, ps); out.append(make_node(o, typ, 1, ps['apos'] or base, ctx, -1, r, 0))
        out.append(make_node(o, typ, 0, ps['cpos'] or ps['pos'] or base, ctx, ctx.next(), r, 1))
        out.append(make_node(o, typ, 2, ps['lpos'] or base, ctx, -1, r, 0))
    elif typ in ('OLET','TEE'):
        center = ps['pos'] or ps['cpos'] or base
        out.append(make_node(o, typ, 1, ps['apos'] or center, ctx, -1))
        out.append(make_node(o, typ, 3, ps['bpos'] or ps['lpos'] or center, ctx, -1))
        out.append(make_node(o, typ, 0, center, ctx, ctx.next()))
        out.append(make_node(o, typ, 2, ps['lpos'] or center, ctx, -1))
    elif typ == 'REDU':
        out.append(make_node(o, typ, 1, ps['apos'] or base, ctx, -1))
        out.append(make_node(o, typ, 0, ps['pos'] or base, ctx, ctx.next(), alpha=reducer_angle(o)))
        out.append(make_node(o, typ, 2, ps['lpos'] or base, ctx, -1))
    elif typ == 'ATTA':
        out.append(make_node(o, typ, 0, base, ctx, ctx.next()))
    elif ps['apos'] and ps['lpos']:
        # Give the fitting a real numbered node so downstream XML->CII can carry the component on an element.
        out.append(make_node(o, typ, 1, ps['apos'], ctx, -1))
        out.append(make_node(o, typ, 0, ps['pos'] or ps['apos'], ctx, ctx.next()))
        out.append(make_node(o, typ, 2, ps['lpos'], ctx, -1))
    else:
        out.append(make_node(o, typ, 0, base, ctx, ctx.next()))
    return out

def node_xml(n):
    lines = ['      <Node>']
    lines.append(f"        <NodeNumber>{n['number']}</NodeNumber>")
    lines.append(f"        <NodeName>{x(n['name'])}</NodeName>")
    lines.append(f"        <Endpoint>{n['endpoint']}</Endpoint>")
    lines.append(f"        <ComponentType>{x(n['ctype'])}</ComponentType>")
    lines.append(f"        <Weight>{nfmt(n['weight'])}</Weight>")
    lines.append(f"        <ComponentRefNo>{x(n['ref'])}</ComponentRefNo>")
    lines.append(f"        <ConnectionType>{x(n['conn'])}</ConnectionType>")
    lines.append(f"        <OutsideDiameter>{nfmt(n['od'])}</OutsideDiameter>")
    lines.append(f"        <WallThickness>{nfmt(n['wall'])}</WallThickness>")
    lines.append(f"        <CorrosionAllowance>{nfmt(n['corr'])}</CorrosionAllowance>")
    lines.append(f"        <InsulationThickness>{nfmt(n['insu'])}</InsulationThickness>")
    p=n['pos']; lines.append(f"        <Position>{p[0]:.2f} {p[1]:.2f} {p[2]:.2f}</Position>")
    lines.append(f"        <BendRadius>{nfmt(n['br'])}</BendRadius>")
    if n['bt'] is not None: lines.append(f"        <BendType>{n['bt']}</BendType>")
    if n['alpha'] is not None: lines.append(f"        <AlphaAngle>{nfmt(n['alpha'])}</AlphaAngle>")
    lines.append(f"        <SIF>{n['sif']}</SIF>")
    lines.append('      </Node>')
    return '\n'.join(lines)

def convert(input_path: Path, output_path: Path, opt):
    data = json.loads(input_path.read_text(encoding='utf-8-sig'))
    branches = branch_list(data)
    if not branches: raise SystemExit('Staged JSON has no branch children.')
    ctx = Ctx(opt); project = input_path.stem; count=0; skipped=0; bytype={}
    lines = ['<?xml version="1.0" encoding="utf-8"?>','<PipeStressExport xmlns="http://aveva.com/pipeStress116.xsd">']
    lines += [f'  <DateTime></DateTime>', f'  <Source>{x(opt.source)}</Source>', '  <Version>0.0.0.0</Version>', '  <UserName>browser-runtime</UserName>', f'  <Purpose>{x(opt.purpose)}</Purpose>', f'  <ProjectName>{x(project)}</ProjectName>', f'  <MDBName>/{x(project)}</MDBName>', f'  <TitleLine>{x(opt.title_line)}</TitleLine>', '  <!-- Configuration information -->', '  <RestrainOpenEnds>No</RestrainOpenEnds>', '  <AmbientTemperature>0</AmbientTemperature>', '  <Pipe>', f'    <FullName>/{x(project)}</FullName>', '    <Ref></Ref>']
    for br in branches:
        ba=attrs(br); lines += ['    <Branch>', f"      <Branchname>{x(br.get('name') or br.get('path') or ba.get('NAME') or 'B1')}</Branchname>"]
        lines.append('      <Temperature>' + ''.join(f'<Temperature{i}>-100000</Temperature{i}>' for i in range(1,10)) + '</Temperature>')
        lines.append('      <Pressure>' + ''.join(f'<Pressure{i}>0</Pressure{i}>' for i in range(1,10)) + '</Pressure>')
        lines += ['      <MaterialNumber>0</MaterialNumber>','      <InsulationDensity>0</InsulationDensity>','      <FluidDensity>0</FluidDensity>']
        for ch in br.get('children', []):
            nodes = expand(ch, ctx)
            if not nodes: skipped += 1; continue
            for node in nodes:
                lines.append(node_xml(node)); count += 1; bytype[node['ctype']] = bytype.get(node['ctype'],0)+1
        lines.append('    </Branch>')
    lines += ['  </Pipe>', f'  <!-- StagedJSON fitting-preserving converter generated {count} Node records; skipped {skipped}. Counts: {bytype} -->', '</PipeStressExport>']
    output_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f"Wrote {output_path} with {count} XML nodes; preserved counts: {bytype}; skipped {skipped}.")

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True); p.add_argument('--output', required=True)
    p.add_argument('--node-start', type=int, default=10); p.add_argument('--node-step', type=int, default=10)
    p.add_argument('--source', default='AVEVA PSI'); p.add_argument('--purpose', default='RMSS staged JSON conversion'); p.add_argument('--title-line', default='RMSS StagedJSON Output')
    p.add_argument('--default-diameter', type=float, default=100.0); p.add_argument('--default-wall-thickness', type=float, default=0.01)
    p.add_argument('--default-insulation-thickness', type=float, default=0.0); p.add_argument('--default-corrosion-allowance', type=float, default=0.0)
    convert(Path(p.parse_args().input), Path(p.parse_args().output), p.parse_args())
if __name__ == '__main__': main()
