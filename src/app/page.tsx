import { Wordmark } from "@/components/ui/fields";

export default function Home() {
  return (
    <div className="sb-page">
      <div className="sb-container">
        <header className="sb-masthead">
          <Wordmark />
          <h1 className="sb-title">
            참가업체 부스 운영 및
            <br />
            럭키드로우 정보 제출
          </h1>
        </header>
        <div className="intro">
          <p>이 페이지는 업체별 전용 링크로만 작성할 수 있습니다.</p>
          <p>운영사무국에서 받은 링크(…/s/로 시작하는 주소)로 접속해 주세요. 링크를 받지 못했다면 운영사무국으로 문의해 주세요.</p>
        </div>
      </div>
    </div>
  );
}
