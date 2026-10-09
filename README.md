# Desktop Calendar Memo v1.4.1

Apple 메모 앱 느낌의 오프라인 Windows 캘린더 + 메모 (Electron).

## v1.4.1 변경 사항

- 피드백 창의 입력칸을 크게 키웠습니다.

## v1.4.0 변경 사항
- 피드백 보내기: 아래쪽 막대의 버튼으로 앱 안에서 바로 후기 · 불편한 점 · 버그를 보낼 수 있어요

## v1.3.1 변경 사항
- 진행 상태 태그(시작 전 · 진행 중 · 완료): 메모 카드 · 사이드 메모에 태그, 캘린더 일정 막대 오른쪽에 색 점
- 메모 폴더: 메모 리스트의 폴더 칩으로 모아 보기, 만들기 · 이름 바꾸기 · 삭제(메모는 유지)
- 메모 아이콘: 모든 테마에서 기본 ♥, 즐겨찾기만 ★

## v1.3.0 변경 사항

### 디자인 정리
- 버전마다 덧씌워 온 `!important` 스타일을 걷어내고 디자인 토큰(`common.css`) 기반으로 스타일시트를 새로 정리
- 이모지 아이콘(📌 ▣ ☷ ⌕ ⚙)을 선 아이콘(SVG)으로 통일
- 툴바 정리: 이전/다음 달 버튼이 월 제목 양옆으로, `일정 추가` 버튼을 상단 툴바로 이동
- 일정 편집 창: 제목을 크게, 편집기·날짜·시간·알림·반복을 2열 그리드로, 하단 버튼 고정
- 일요일/토요일 날짜 색, 메모 카드·필터·검색창·설정·사이드 메모 패널 디자인 통일
- 칸이 좁아 가려지는 일정은 날짜 옆에 `+N` 으로 표시
- `도움말` 버튼이 실제로 마크다운·단축키 안내 창을 열도록 연결

### 일정 등록: 마크다운 · 체크박스
- **버그 수정**: 예전 Trix 편집기용 코드가 남아 새 편집기 함수를 덮어쓰고 있어서
  굵게/기울임/제목/목록/할 일 버튼과 Ctrl+B·I·U 가 전혀 동작하지 않던 문제
- 줄 맨 앞 마크다운 입력 → 바로 서식 적용: `# ` `## ` `### ` `- ` `1. ` `[] ` `[x] ` `> ` `---`+Enter
- 인라인 마크다운: `**굵게**` `*기울임*` `~~취소선~~` `` `코드` ``
- 할 일: Enter 로 다음 할 일, 빈 할 일에서 Enter 로 목록 끝내기, 맨 앞 Backspace 로 체크박스만 해제,
  Ctrl+Shift+C 로 여러 줄을 한 번에 할 일로 변환
- 마크다운 텍스트 붙여넣기 시 서식으로 변환 (다른 프로그램의 글꼴·색은 제거)
- 밑줄(`<u>`)·별표 같은 기호가 저장 후 다시 열 때 깨지던 문제 수정 (글자 속 기호는 이스케이프해서 저장)
- 메모 리스트에서 체크박스 옆 글자를 누르면 편집 창이 같이 열리던 문제 수정
- 사이드 고정 메모도 같은 마크다운 변환기(`renderer/markdown.js`) 사용 — 목록·인용·취소선 등이 동일하게 보이고,
  메모 내용 속 HTML 이 그대로 실행되던 문제(XSS) 수정
- 31일에 `다음 달`을 누르면 한 달을 건너뛰던 문제 수정
- Esc 로 창 닫기, Ctrl+Enter / Ctrl+S 로 저장
- 쓰지 않는 `trix` 의존성 제거

기존 `data.json` 은 그대로 읽을 수 있습니다.

## 테마
설정(⚙) → 테마에서 고를 수 있고, 사이드 고정 메모에도 바로 적용됩니다.
- **기본**: 깔끔한 흰색
- **그라데이션**: 은은한 3색 그라데이션. 배경 3색과 강조색을 직접 바꿀 수 있음
- **민트 피아노**: 민트 · 브라운 · 화이트, 별·물방울 무늬와 아래쪽 피아노 건반
- **Y2K 윈도우**: 하늘색 유리 제목 막대, 연두 반짝 버튼, 클로버·별 무늬, 픽셀 글꼴
  (제목·날짜·버튼: Neo둥근모, SIL OFL 1.1 — `assets/fonts/NeoDunggeunmo-OFL.txt` / 본문: 조선굴림 — `assets/fonts/ChosunGu-NOTICE.txt`)

테마 색은 `renderer/common.css` 맨 위의 테마 토큰으로 정의되어 있어, 새 테마는 토큰 블록 하나(`:root[data-theme="..."]`)와
`renderer/theme.js` 의 목록 한 줄을 추가하면 됩니다.

## 설치 없이 브라우저에서 미리보기
저장소 맨 위의 `index.html` 은 실제 앱 화면(`renderer/`)을 브라우저에서 그대로 띄우는 미리보기 페이지입니다.
`renderer/browser-shim.js` 가 Electron 대신 브라우저 저장소(localStorage)를 쓰는 가짜 `desktopAPI` 를 만들어 줍니다
(설치된 앱에서는 아무 일도 하지 않습니다).

- 로컬: 이 폴더에서 `npx serve` 또는 `python -m http.server` 실행 후 http://localhost:3000 (또는 :8000) 열기
- GitHub Pages: 저장소 Settings → Pages → Branch 를 `main` / `(root)` 로 설정하면
  `https://<아이디>.github.io/DesktopCalendarMemo/` 에서 열리고, main 에 합칠 때마다 자동 갱신됩니다.

## 개발 PC에서 실행
최초 1회 인터넷 연결 상태에서 `setup.bat` 실행 후 `run.bat`으로 실행합니다.

## 테스트
편집기의 마크다운·체크박스 동작을 헤드리스 Chromium 으로 확인합니다.
```
npm i -D playwright
npx playwright install chromium
npm test
```

## 배포하기 (누구나 내려받기) · 업데이트 알림
설치 파일은 GitHub Releases 에 올리고, 설치된 앱은 Releases 를 6시간마다(그리고 켤 때) 확인합니다.
새 버전이 있으면 백그라운드로 받아서 Windows 알림 + 앱 안 안내 창으로 알려 주고, 다시 시작하면 적용됩니다.

### 처음 한 번
1. 저장소를 **공개(Public)** 로 바꾸기 — Settings → General → Danger Zone → Change visibility
   (비공개 저장소의 Releases 는 다른 사람이 받을 수 없습니다. 코드를 비공개로 두고 싶으면
   설치 파일만 올릴 공개 저장소를 따로 만들고 `package.json` 의 `build.publish` 의 `repo` 를 그 이름으로 바꾼 뒤,
   그 저장소에 쓸 수 있는 토큰을 이 저장소 Secrets 에 `GH_TOKEN` 으로 넣고 워크플로의 `GH_TOKEN` 을 그것으로 바꿉니다.)
2. 이 PR 을 `main` 에 합치기

### 새 버전을 낼 때마다
1. `release-notes.md` 에 바뀐 점 적기 (앱의 업데이트 안내 창에 그대로 보입니다)
2. 버전 올리고 태그 푸시
   ```
   npm version 1.4.1        # package.json 버전 변경 + 커밋 + v1.4.1 태그
   git push --follow-tags
   ```
   (태그 대신 GitHub 의 **Actions → Release → Run workflow** 버튼을 눌러도 됩니다.
   이때는 `npm version` 으로 올린 버전을 `main` 에 푸시해 둔 상태여야 합니다.
   같은 버전을 다시 만들고 싶으면 버튼 옆의 **rebuild** 를 켜고 실행하면 기존 릴리스를 지우고 새로 올립니다.)
3. GitHub Actions 가 Windows 설치 파일을 만들어 Releases 에 올립니다(약 5~10분).
   다운로드 주소: `https://github.com/boriboris2al/desktop-calendar-memo/releases/latest`

> 코드 서명을 하지 않은 설치 파일이라 처음 실행할 때 Windows 가 "PC 보호" 경고를 띄웁니다.
> "추가 정보 → 실행" 으로 설치할 수 있습니다.

## 최종 설치 프로그램 만들기 (내 PC 에서만)
인터넷 연결 상태에서 `make_installer.bat`을 실행하면 `dist` 폴더에
`DesktopCalendarMemo_v1.4.1.exe`가 생성되도록 구성되어 있습니다.

최종 설치 프로그램은 Electron/필요 리소스를 포함하므로 사용자가 Node.js나 npm을 설치할 필요가 없습니다.
