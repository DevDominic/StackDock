import {
  mdiLanguageLua,
  mdiLanguageTypescript,
  mdiLanguageJavascript,
  mdiLanguagePython,
  mdiLanguageRust,
  mdiLanguageGo,
  mdiLanguageC,
  mdiLanguageCpp,
  mdiLanguageCsharp,
  mdiLanguageRuby,
  mdiLanguagePhp,
  mdiLanguageJava,
  mdiLanguageKotlin,
  mdiLanguageSwift,
  mdiLanguageHtml5,
  mdiLanguageCss3,
  mdiLanguageMarkdown,
  mdiSass,
  mdiVuejs,
  mdiNodejs,
  mdiDocker,
  mdiGit,
  mdiConsole,
  mdiCodeJson,
  mdiFileCodeOutline,
  mdiFileDocumentOutline,
  mdiImageOutline,
  mdiFilePdfBox,
  mdiCogOutline,
  mdiFolderOutline,
  mdiFolderOpenOutline,
  mdiFileOutline,
} from '@mdi/js';

/*
 * File-type icons from Pictogrammers Material Design Icons (@mdi/js).
 * Each export is the raw 24x24 path data, rendered with currentColor so the
 * icons stay monochrome and recolor with the theme. Only the icons imported
 * above are bundled (tree-shaken), so this stays lightweight.
 */

// Short key -> { path data, css class for optional theme tint }.
const icons: Record<string, string> = {
  folder: mdiFolderOutline,
  folderOpen: mdiFolderOpenOutline,
  file: mdiFileOutline,
  lua: mdiLanguageLua,
  ts: mdiLanguageTypescript,
  js: mdiLanguageJavascript,
  py: mdiLanguagePython,
  rust: mdiLanguageRust,
  go: mdiLanguageGo,
  c: mdiLanguageC,
  cpp: mdiLanguageCpp,
  csharp: mdiLanguageCsharp,
  ruby: mdiLanguageRuby,
  php: mdiLanguagePhp,
  java: mdiLanguageJava,
  kotlin: mdiLanguageKotlin,
  swift: mdiLanguageSwift,
  html: mdiLanguageHtml5,
  css: mdiLanguageCss3,
  sass: mdiSass,
  vue: mdiVuejs,
  md: mdiLanguageMarkdown,
  json: mdiCodeJson,
  data: mdiFileCodeOutline,
  doc: mdiFileDocumentOutline,
  image: mdiImageOutline,
  pdf: mdiFilePdfBox,
  config: mdiCogOutline,
  shell: mdiConsole,
  node: mdiNodejs,
  docker: mdiDocker,
  git: mdiGit,
};

// Exact filename matches take priority over extension.
const fileNameMap: Record<string, keyof typeof icons> = {
  'package.json': 'node',
  'package-lock.json': 'node',
  'tsconfig.json': 'ts',
  'dockerfile': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
};

const extensionMap: Record<string, keyof typeof icons> = {
  // lua / luau (Roblox)
  lua: 'lua', luau: 'lua',
  // languages
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  py: 'py', pyw: 'py',
  rs: 'rust',
  go: 'go',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  html: 'html', htm: 'html',
  vue: 'vue',
  // styles
  css: 'css',
  scss: 'sass', sass: 'sass', less: 'css',
  // data
  json: 'json', jsonc: 'json',
  yaml: 'data', yml: 'data', toml: 'data', xml: 'data', csv: 'data',
  // docs
  md: 'md', mdx: 'md',
  txt: 'doc', rst: 'doc', log: 'doc',
  pdf: 'pdf',
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image', bmp: 'image',
  // shells / scripts
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
  // config
  env: 'config', ini: 'config', conf: 'config', lock: 'config', editorconfig: 'config',
};

function categorize(name: string): keyof typeof icons {
  const lower = name.toLowerCase();
  if (fileNameMap[lower]) return fileNameMap[lower];
  // Dotfiles like .gitignore / .env have no real extension.
  const bare = lower.startsWith('.') ? lower.slice(1) : lower;
  const ext = bare.includes('.') ? bare.split('.').pop()! : bare;
  return extensionMap[ext] ?? 'file';
}

export function FileIcon({ name, isDirectory, expanded }: { name: string; isDirectory: boolean; expanded: boolean }) {
  const key = isDirectory ? (expanded ? 'folderOpen' : 'folder') : categorize(name);
  return (
    <span className={`tree-icon tree-icon-${key}`}>
      <svg className="tree-icon-svg" width="16" height="16" viewBox="0 0 24 24">
        <path d={icons[key]} fill="currentColor" />
      </svg>
    </span>
  );
}
