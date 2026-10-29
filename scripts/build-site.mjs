// 公開する静的ファイルだけをGitHub Pages用のフォルダにコピーします。
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = path.join(projectRoot, '_site');
const publicFiles = [
  'index.html', 'simple.css', 'No_001~2.png',
  'file_0000000078ac61f7b83750d02fab108a.png',
  'robots.txt', 'sitemap.xml',
  'bagcat_labels.csv', 'type_options.csv',
  'bazzarList.json',
  'update-status.json', 'itemAnother.json', 'itemCodeSchema.json',
  'buzzerHistory.json', 'malebuzzerHistory.json', 'femalebuzzerHistory.json',
];

// 出力フォルダを毎回作り直して、残存ファイルの誤公開を防ぎます。
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const filename of publicFiles) {
  await cp(path.join(projectRoot, filename), path.join(outputDirectory, filename));
}
await writeFile(path.join(outputDirectory, '.nojekyll'), '', 'utf8');
console.log('GitHub Pages用ファイルを生成しました: ' + outputDirectory);
