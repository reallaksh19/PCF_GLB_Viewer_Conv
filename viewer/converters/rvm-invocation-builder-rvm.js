function sanitizeFileName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return 'input.rvm';
  return normalized.replace(/[\\/:*?"<>|]/g, '_');
}

function baseNameWithoutExtension(name) {
  const cleaned = sanitizeFileName(name);
  const idx = cleaned.lastIndexOf('.');
  if (idx <= 0) return cleaned;
  return cleaned.slice(0, idx);
}

function outputName(primaryName, extension) {
  const stem = baseNameWithoutExtension(primaryName);
  return `${stem}${extension}`;
}

export function buildRvmInvocation(primaryPath, primaryName, secondaryPath, jobDir) {
  const glbOutputName = outputName(primaryName, '.glb');
  const jsonOutputName = outputName(primaryName, '-attrs.json');

  const glbOutputPath = `${jobDir}/${glbOutputName}`;
  const jsonOutputPath = `${jobDir}/${jsonOutputName}`;

  const argv = [
    `--output-gltf=${glbOutputPath}`,
    `--output-json=${jsonOutputPath}`,
    '--output-gltf-attributes=true',
    '--output-gltf-center=true',
    '--output-gltf-rotate-z-to-y=true',
    primaryPath
  ];

  if (secondaryPath) {
    argv.push(secondaryPath);
  }

  return {
    glbOutputPath,
    glbOutputName,
    jsonOutputPath,
    jsonOutputName,
    argv,
  };
}
