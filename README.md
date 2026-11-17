# 러너스 예배

러너스 주일 예배의 사회·대표기도 배정, 대표기도 순서, 사회 원고를 관리하는 웹앱(PWA)입니다. 휴대폰 홈 화면에 설치해서 앱처럼 쓸 수 있습니다.

- 화면: GitHub Pages (무료)
- 배정·명단 데이터: Firebase Firestore 무료 플랜
- 본문·설교 제목·묵도·헌금기도: `data/sermons.json` (매주 예약 작업이 안암UBF 주일말씀 게시판을 읽어 갱신)

## 처음 설정
1. Firebase 콘솔에서 프로젝트 생성 → 웹 앱 추가 → 설정값을 `firebase-config.js`에 넣기
2. Authentication → 로그인 방법 → Google 사용 설정, 승인된 도메인에 `<아이디>.github.io` 추가
3. Firestore Database 만들기(서울 asia-northeast3) → 규칙 탭에 `firestore.rules` 붙여넣기(운영자 이메일 수정)
4. 운영자로 로그인 → 더보기 → 데이터 가져오기

## 운영자 추가
`firestore.rules`의 `adminEmails()` 목록에 이메일을 추가하고 Firebase 콘솔 규칙 탭에 다시 게시합니다.
