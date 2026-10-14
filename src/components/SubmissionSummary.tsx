"use client";

import { discountRate, formatNumber, formatWon, giftSummary, giftTotal } from "@/lib/calc";
import type { SubmissionInput } from "@/lib/types";
import { PriceSign } from "./PriceSign";

/** 제출 내용 한눈에 보기 (제출 전 확인 · 관리자 상세보기 공용) */
export function SubmissionSummary({ data, showSigns = true }: { data: SubmissionInput; showSigns?: boolean }) {
  const gs = giftSummary(data.luckyDrawProvided ? data.gifts : []);
  return (
    <>
      <div className="summary-block">
        <dl className="kv">
          <dt>참가업체명</dt>
          <dd>{data.companyName}</dd>
          <dt>대표 판매상품</dt>
          <dd>{data.products.length}개</dd>
          <dt>럭키드로우</dt>
          <dd>
            {data.luckyDrawProvided ? (
              <span className="num">
                제공함 · {gs.kinds}종 · 총 {formatNumber(gs.quantity)}개 · 정상가 기준 {formatWon(gs.amount)}
              </span>
            ) : (
              "제공하지 않음"
            )}
          </dd>
        </dl>
      </div>

      <div className="summary-block">
        <h3 style={{ fontSize: 16, margin: "0 0 10px" }}>대표 판매상품</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="c">번호</th>
                <th>상품명</th>
                <th className="r">정상가</th>
                <th className="r">행사 할인가</th>
                <th className="c">할인율</th>
                <th className="c">샘플 제공</th>
                <th>추가 이벤트 혜택</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p, i) => {
                const r = discountRate(p.regularPrice, p.eventPrice);
                return (
                  <tr key={i}>
                    <td className="c">{i + 1}</td>
                    <td style={{ fontWeight: 650, minWidth: 160 }}>{p.name}</td>
                    <td className="r">{formatWon(p.regularPrice)}</td>
                    <td className="r">{formatWon(p.eventPrice)}</td>
                    <td className="c num">{r == null ? "-" : `${r}%`}</td>
                    <td className="c">{p.sampleProvided ? "제공함" : "제공하지 않음"}</td>
                    <td style={{ minWidth: 180 }}>{p.extraBenefit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showSigns && (
        <div className="summary-block">
          <h3 style={{ fontSize: 16, margin: "0 0 10px" }}>가격 안내판 미리보기</h3>
          <div className="sign-grid">
            {data.products.map((p, i) => (
              <PriceSign key={i} company={data.companyName} index={i + 1} {...p} />
            ))}
          </div>
        </div>
      )}

      {data.luckyDrawProvided && (
        <div className="summary-block">
          <h3 style={{ fontSize: 16, margin: "0 0 10px" }}>럭키드로우 경품</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">번호</th>
                  <th>제공 상품명</th>
                  <th className="r">제공 수량</th>
                  <th className="r">정상 판매가(1개)</th>
                  <th className="r">총금액</th>
                </tr>
              </thead>
              <tbody>
                {data.gifts.map((g, i) => (
                  <tr key={i}>
                    <td className="c">{i + 1}</td>
                    <td style={{ fontWeight: 650, minWidth: 160 }}>{g.name}</td>
                    <td className="r">{formatNumber(g.quantity)}개</td>
                    <td className="r">{formatWon(g.unitPrice)}</td>
                    <td className="r">{formatWon(giftTotal(g))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>합계</td>
                  <td className="r num">{formatNumber(gs.quantity)}개</td>
                  <td />
                  <td className="r num">{formatWon(gs.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
