# labeling.seoul — 베타 v0.1

미국 건강기능식품 라벨 이미지를 올리면 AI가 라벨을 읽고, 규칙 표(23개)로 판정해서 체크리스트를 보여줘요.
설치할 패키지가 없어요. Node.js만 있으면 돼요.

## 구조

```
data/rules_us_supplement.csv   규칙 표 (엑셀에서 고치고 CSV로 저장)
lib/extract.js                 AI가 라벨을 읽는 부분 (Claude API) + 샘플 라벨
lib/evaluate.js                규칙별 판정 코드 (AI는 읽기만, 판정은 여기서)
lib/rules.js                   CSV 읽기
lib/evaluate.test.js           테스트 (npm test)
api/check.js                   서버 API: 이미지 → 판정 결과
public/                        화면 (index.html, style.css, app.js)
server.js                      내 컴퓨터에서 실행하는 서버
```

## 1. 내 컴퓨터에서 실행

1. Node.js 20 이상 설치: https://nodejs.org (LTS)
2. 터미널에서 이 폴더로 이동한 뒤 실행:
   ```
   node server.js
   ```
3. 브라우저에서 http://localhost:3000 열기 → "샘플 라벨로 해보기"

## 2. 실제 사진으로 검사하기 (API 키)

1. https://console.anthropic.com 가입 → 결제 수단 등록 → API Keys에서 키 발급
2. `.env.example`을 복사해서 `.env`로 이름을 바꾸고 `ANTHROPIC_API_KEY=` 뒤에 키 붙여넣기
3. 서버를 다시 실행하면 사진 업로드가 작동해요
4. 키는 절대 GitHub에 올리지 마세요 (`.gitignore`에 이미 빠져 있어요)

## 3. 인터넷에 올리기 (Vercel, 무료)

1. GitHub에 새 저장소를 만들고 이 폴더를 올려요 (GitHub Desktop 앱이 제일 쉬워요)
2. https://vercel.com 에 GitHub로 로그인 → Add New → Project → 저장소 선택
3. Framework Preset: **Other**, Build Command 비워두기
4. Environment Variables에 `ANTHROPIC_API_KEY` 추가 → Deploy
5. 나온 주소를 브랜드사에 공유하면 끝

## 규칙 고치기

`data/rules_us_supplement.csv`를 엑셀로 열어 수정하고 CSV(UTF-8)로 저장해요.
새 규칙을 추가했다면 `lib/evaluate.js`의 `CHECKS`에 같은 rule_id로 판정 함수를 추가해요.
판정 함수가 없는 규칙은 자동으로 "확인 필요"로 표시돼서 빠지지 않아요.
수정 후 `npm test`로 테스트가 통과하는지 확인해요.

## 다음 단계 후보

- 결과 화면에 "맞아요 / 틀렸어요" 피드백 버튼 + 후기 저장 (Supabase)
- 검사 결과 공유 링크, PDF 저장
- EU·영국, 화장품, 가공식품 규칙 표 추가
- 이미지 대신 PDF 업로드

이 도구는 법률 자문이 아니에요. 출시 전 최종 라벨은 규제 전문가의 검토를 받아야 해요.
