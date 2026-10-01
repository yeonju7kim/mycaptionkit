# My CaptionKit

교회 통역 운영을 위한 로컬 CaptionKit 컨트롤러입니다. CaptionKit의 Speaker Language와 Live 상태를 자동으로 따라가며, ProPresenter에는 변하지 않는 Display 주소를 한 번만 등록하면 됩니다.

## 화면 구성

- `http://127.0.0.1:4173/control` — 운영자가 사용하는 조작 화면과 두 송출 미리보기
- `http://127.0.0.1:4173/display/full` — 프로젝터용 검은 전체 화면
- `http://127.0.0.1:4173/display/subtitle` — ProPresenter의 PPT 위에 올리는 투명 자막

Control에서 Full Screen과 Subtitle의 줄 수(1~10줄), 글자 크기, 줄 간격, 너비를 각각 바꾸면 해당 Display에 즉시 반영됩니다. Position과 배경 같은 세부 항목도 Settings에서 화면별로 조절할 수 있습니다.

CaptionKit이 Live가 아닐 때 Control의 미리보기에는 설정을 확인할 수 있는 예시 문장이 반복해서 표시됩니다. 실제 Display 주소에는 예시가 나오지 않으며, Live가 시작되면 미리보기도 실제 자막으로 자동 전환됩니다.

## 설치 전 준비

### 필수

1. **[Node.js LTS](https://nodejs.org/en/download)** — Node.js 18 이상이 필요하며 최신 LTS 버전을 권장합니다.
2. **[Google Chrome](https://www.google.com/chrome/)** — CaptionKit 마이크 권한과 운영에 사용합니다.
3. **[CaptionKit 계정](https://captionkit.com/)** — 별도 프로그램 설치 없이 브라우저에서 사용합니다. 로그인은 [CaptionKit Dashboard](https://app.captionkit.com/)에서 합니다.
4. **마이크** — 컴퓨터에 연결된 USB 마이크나 오디오 인터페이스 입력이 필요합니다.

### 선택

- **[ProPresenter](https://renewedvision.com/propresenter/download)** — PPT 위에 투명 자막을 올릴 때만 필요합니다.
- **[Git for Windows](https://git-scm.com/downloads/win)** — 저장소를 `git clone`으로 받을 때만 필요합니다. 아래 ZIP 다운로드 방식을 사용하면 설치하지 않아도 됩니다.

`npm install`은 필요하지 않습니다. 이 프로젝트는 외부 Node.js 패키지를 사용하지 않습니다.

## 다운로드와 실행

가장 쉬운 방법은 다음과 같습니다.

1. **[프로젝트 ZIP 다운로드](https://github.com/yeonju7kim/mycaptionkit/archive/refs/heads/main.zip)**를 누릅니다.
2. 다운로드한 ZIP 파일의 압축을 풉니다.
3. 폴더 안의 `start-captionkit.cmd`를 더블 클릭합니다.
4. 브라우저에서 `http://127.0.0.1:4173/control`이 자동으로 열립니다.

Git을 사용하는 경우:

```powershell
git clone https://github.com/yeonju7kim/mycaptionkit.git
cd mycaptionkit
.\start-captionkit.cmd
```

이미 실행 중일 때 `start-captionkit.cmd`를 다시 실행하면 서버를 중복 실행하지 않고 기존 Control 화면만 엽니다. 종료하려면 열린 My CaptionKit 터미널에서 `Ctrl+C`를 누릅니다.

## 처음 설정하기

1. [CaptionKit Dashboard](https://app.captionkit.com/)에 로그인합니다.
2. CaptionKit의 **Account settings → API Keys**에서 API 키를 생성합니다.
3. My CaptionKit Control 오른쪽 위의 **⚙ Settings**를 엽니다.
4. API 키와 CaptionKit handle을 입력하고 저장합니다. Handle은 CaptionKit 주소의 마지막 부분입니다. 예: `https://app.captionkit.com/kcic-ytpx2u`의 handle은 `kcic-ytpx2u`입니다.
5. CaptionKit 대시보드에서 필요한 번역 언어 출력을 활성화합니다.
6. Control 맨 위의 **Open CaptionKit**을 눌러 해당 handle의 대시보드를 엽니다.

현재 기본 handle은 제공받은 링크의 `kcic-ytpx2u`로 설정되어 있습니다. 영어 코드 기본값은 `en-US`, 한국어는 `ko`입니다. CaptionKit 대시보드에서 활성화한 번역 언어 코드와 정확히 일치시켜 주세요.

터미널에서 실행하려면:

```powershell
node server.js --open
```

## 마이크 준비하기

Control 화면의 **Settings → Microphone → Test microphone**은 이 PC에서 선택한 마이크가 실제 음성을 받는지 7초 동안 검사합니다. 이 테스트 권한은 로컬 주소(`127.0.0.1`)에만 적용됩니다.

실제 자막 음성은 CaptionKit 대시보드가 받으므로 **Open CaptionKit**을 눌러 Settings에 저장한 handle의 대시보드를 연 뒤 다음 항목도 설정해야 합니다.

1. CaptionKit의 **Open audio permissions**에서 Chrome 마이크 권한을 허용합니다.
2. 오른쪽 입력 목록에서 사용할 마이크를 선택하고 **Test Inputs**로 레벨을 확인합니다.
3. 오른쪽의 **Caption Controls**에서 **Speaker Language**를 선택합니다.
4. **⚡ 버튼**을 눌러 AI 통역을 시작합니다. 로컬 Display는 자동으로 연결됩니다.

브라우저 보안상 로컬 Control이 `app.captionkit.com`의 마이크 권한을 대신 승인하거나 로컬 권한을 전달할 수는 없습니다.

## ProPresenter에 연결하기

1. ProPresenter에서 자막용 Prop을 만듭니다.
2. Web Fill 레이어를 추가합니다.
3. URL에 다음 주소를 입력합니다.

```text
http://127.0.0.1:4173/display/subtitle
```

4. Web Fill을 출력 전체 크기로 맞춥니다. 보통 `1920 × 1080`입니다.
5. 이 Prop은 그대로 유지합니다. 이후 변경은 Control 화면에서만 합니다.

송출 상태를 직접 확인하려면 다음 디버그 주소를 새 브라우저에서 열 수 있습니다. ProPresenter에는 디버그 주소가 아닌 위의 일반 Display 주소를 사용하세요.

```text
http://127.0.0.1:4173/display/subtitle?debug=1
```

## 예배 중 사용 순서

1. Control 맨 위의 **Open CaptionKit**을 누릅니다.
2. 오른쪽 **Caption Controls**에서 **Speaker Language**를 선택합니다.
3. **⚡ 버튼**을 눌러 AI 통역을 시작합니다.
4. 이 앱은 Live 상태를 계속 확인하며 자동으로 연결합니다. 한국어면 영어를, 영어면 한국어를 표시합니다.

두 화면 모두 완성된 문장마다 새 줄로 표시합니다. 기존 `/display` 주소는 Subtitle과 동일하게 계속 사용할 수 있습니다.

CaptionKit 번역은 원문 자막보다 약 1~2초 늦게 표시될 수 있습니다.

## 설정과 보안

API 키와 화면 설정은 처음 저장할 때 `.captionkit.local.json`에 기록됩니다. 이 파일과 `.env`는 Git에서 제외됩니다. API 키는 브라우저의 Display 페이지나 CaptionKit 표시 URL에 포함되지 않습니다.

환경 변수로 API 키를 관리하려면 `.env.example`을 `.env`로 복사하고 다음 값을 설정합니다.

```dotenv
CAPTIONKIT_API_KEY=your_api_key
```

기본 서버는 `127.0.0.1`에만 열리므로 같은 컴퓨터에서만 접속할 수 있습니다.

### 휴대폰이나 다른 컴퓨터에서 Control 사용하기

`.env`에 다음처럼 설정한 후 서버를 다시 시작합니다.

```dotenv
HOST=0.0.0.0
PORT=4173
CONTROL_PIN=change-this-pin
```

Control 화면 설정에도 같은 PIN을 입력합니다. 다른 기기에서는 My CaptionKit PC의 내부 IP로 접속합니다.

```text
http://192.168.x.x:4173/control
```

교회 외부 인터넷에 이 포트를 직접 공개하지 마세요. Windows 방화벽 허용이 필요할 수 있습니다.

## 문제 해결

- 자막이 시작되지 않으면 CaptionKit 오른쪽의 **Caption Controls**에서 Speaker Language를 선택하고 **⚡ 버튼**을 눌렀는지 확인합니다.
- `401` 오류는 API 키 또는 Control PIN을 확인합니다.
- 번역이 비어 있으면 해당 출력 언어가 CaptionKit 대시보드에 미리 활성화되어 있는지 확인합니다.
- ProPresenter 화면이 비어 있으면 `start-captionkit.cmd`가 실행 중인지 확인하고 브라우저에서 `/display/subtitle?debug=1`을 엽니다.
- 방금 시작·종료한 상태는 CaptionKit 상태 API에 반영되는 데 잠시 걸릴 수 있습니다.

## 개발 확인

```powershell
node --test
```

외부 런타임 패키지는 사용하지 않습니다.
