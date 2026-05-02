/**
 * smart-2d-converter.js
 * Core logic for simplifying 3D piping geometry into 2D representations.
 * Implements 5-step reduction algorithm:
 * 1. Remove Short Legs (< 3xOD)
 * 2. Merge Collinear Legs
 * 3. Split at Anchors
 * 4. Split at Guide + Line Stop
 * 5. Cancel Opposing Legs
 */

const LOG_PREFIX = '[Smart2DConverter]';

/**
 * Main entry point.
 * @param {Array} components - Raw PCF components (parsed objects)
 * @param {Object} config - Configuration options (e.g. OD multiplier)
 * @returns {Object} result - { segments: [], logs: [] }
 */
export function simplifyGeometry(components, config = {}) {
    const logs = [];
    const log = (msg) => logs.push(msg);

    log(`Starting analysis on ${components.length} components.`);

    // Pre-processing: Convert components to a linked list or graph of "Legs"
    // A "Leg" is a straight run of pipe between two nodes (fittings/anchors).
    // For this mock/MVP, we'll linearize the components into a sequence of vectors.

    let legs = extractLegs(components, log);
    log(`Extracted ${legs.length} initial legs.`);

    // Step 1: Remove Short Legs
    legs = removeShortLegs(legs, config, log);

    // Step 2: Merge Collinear Legs
    legs = mergeCollinearLegs(legs, log);

    // Step 3: Split at Anchors (and Step 4: Guides)
    // For now, we treat the whole sequence as one system unless explicit anchors found
    const systems = splitSystems(legs, log);

    // Step 5: Cancel Opposing Legs (per system)
    const finalSystems = systems.map(sys => cancelOpposingLegs(sys, log));

    return {
        systems: finalSystems,
        logs: logs
    };
}

/**
 * Convert raw components into abstract "Leg" objects.
 * Leg: { id, start: {x,y,z}, end: {x,y,z}, vector: {x,y,z}, length, od, type }
 */
function extractLegs(components, log) {
    const legs = [];
    let currentLeg = null;

    components.forEach((comp, idx) => {
        if (comp.type === 'PIPE') {
            const p1 = comp.points[0];
            const p2 = comp.points[1];
            if (!p1 || !p2) return;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dz = p2.z - p1.z;
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const od = comp.bore || 0; // Simplified OD usage

            legs.push({
                id: `leg-${idx}`,
                start: { ...p1 },
                end: { ...p2 },
                vector: { x: dx, y: dy, z: dz },
                length: len,
                od: od,
                axis: getDominantAxis(dx, dy, dz),
                originalComp: comp
            });
        }
        // Anchors/Fittings are nodes, handled implicitly by leg connectivity for now
    });
    return legs;
}

function getDominantAxis(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax > ay && ax > az) return x > 0 ? '+X' : '-X';
    if (ay > ax && ay > az) return y > 0 ? '+Y' : '-Y';
    return z > 0 ? '+Z' : '-Z';
}

function removeShortLegs(legs, config, log) {
    const thresholdMultiplier = config.shortLegMultiplier || 3;
    const filtered = legs.filter(leg => {
        const threshold = leg.od * thresholdMultiplier;
        if (leg.length < threshold) {
            log(`Step 1: Removed short leg ${leg.id} (L=${leg.length.toFixed(1)} < ${threshold})`);
            return false;
        }
        return true;
    });
    return filtered;
}

function mergeCollinearLegs(legs, log) {
    if (legs.length === 0) return [];

    const merged = [];
    let current = legs[0];

    for (let i = 1; i < legs.length; i++) {
        const next = legs[i];
        if (current.axis === next.axis) {
            // Merge
            log(`Step 2: Merging collinear legs ${current.id} and ${next.id} (${current.axis})`);
            current.length += next.length;
            current.end = next.end; // Extend end
            current.vector.x += next.vector.x;
            current.vector.y += next.vector.y;
            current.vector.z += next.vector.z;
            current.id += `+${next.id}`;
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

function splitSystems(legs, log) {
    // Placeholder for Step 3/4 logic
    // For the mock scenario, we assume one system between start/end anchors
    return [legs];
}

function cancelOpposingLegs(legs, log) {
    // Calculate net expansion per axis
    const net = { X: 0, Y: 0, Z: 0 };

    legs.forEach(leg => {
        const axis = leg.axis.charAt(1); // X, Y, or Z
        const sign = leg.axis.charAt(0) === '+' ? 1 : -1;
        net[axis] += sign * leg.length;
    });

    log(`Step 5 Net: X=${net.X.toFixed(1)}, Y=${net.Y.toFixed(1)}, Z=${net.Z.toFixed(1)}`);

    // Mark axes as cancelled if net is near zero
    const CANCEL_TOLERANCE = 10.0; // mm
    const cancelledAxes = new Set();
    if (Math.abs(net.X) < CANCEL_TOLERANCE) cancelledAxes.add('X');
    if (Math.abs(net.Y) < CANCEL_TOLERANCE) cancelledAxes.add('Y');
    if (Math.abs(net.Z) < CANCEL_TOLERANCE) cancelledAxes.add('Z');

    if (cancelledAxes.size > 0) {
        log(`Step 5: Cancelled axes: ${Array.from(cancelledAxes).join(', ')}`);

        // Filter out legs on cancelled axes?
        // Or mark them as "Passive"?
        // Requirement: "Remove it from active problem".
        // We'll filter them out for the 2D visualization of the "L" shape.
        return legs.filter(leg => !cancelledAxes.has(leg.axis.charAt(1)));
    }

    return legs;
}
