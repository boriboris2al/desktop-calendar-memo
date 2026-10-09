// 조선굴림 글꼴은 저장소에 넣지 않고, npm install 때 @noonnu/chosun-gu 패키지에서 assets/fonts 로 복사합니다.
// (설치 파일에는 들어가지만 공개 저장소에서는 글꼴 파일을 내려받을 수 없게 하기 위함)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', '@noonnu', 'chosun-gu', 'fonts', 'chosungu-normal.woff');
const dest = path.join(__dirname, '..', 'assets', 'fonts', 'ChosunGu.woff');

if (!fs.existsSync(src)) {
  console.warn('[copy-fonts] 조선굴림 글꼴을 찾지 못했습니다. Y2K 테마 본문은 기본 글꼴로 보입니다.');
  process.exit(0);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-fonts] 조선굴림 글꼴을 준비했습니다:', path.relative(process.cwd(), dest));
