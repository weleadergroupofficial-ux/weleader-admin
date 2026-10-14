"use client";

import { discountRate, formatNumber } from "@/lib/calc";

/** 행사장 가격 안내판 미리보기 */
export function PriceSign({
  company,
  index,
  name,
  regularPrice,
  eventPrice,
  sampleProvided,
  extraBenefit,
}: {
  company: string;
  index: number;
  name: string;
  regularPrice: number | null;
  eventPrice: number | null;
  sampleProvided: boolean | null;
  extraBenefit: string;
}) {
  const rate = discountRate(regularPrice, eventPrice);
  const price = eventPrice ?? regularPrice;
  const benefit = extraBenefit.trim();
  return (
    <div className="price-sign" aria-label={`가격 안내판 미리보기, 상품 ${index}`}>
      <div className="ps-band">
        <span>BEAUTY WAVE 2026</span>
        <span>No.{index}</span>
      </div>
      <div className="ps-body">
        <div className="ps-brand">{company.trim() || "참가업체명"}</div>
        <div className={`ps-name${name.trim() ? "" : " placeholder"}`}>{name.trim() || "대표 판매상품명"}</div>
        <div className="ps-prices">
          <div>
            {rate != null && rate > 0 && <div className="ps-regular num">{formatNumber(regularPrice)}원</div>}
            <div className={`ps-price num${price == null ? " placeholder" : ""}`}>
              {price == null ? "0" : formatNumber(price)}
              <small>원</small>
            </div>
          </div>
          {rate != null && rate > 0 && <div className="ps-rate num">{rate}%</div>}
        </div>
        {(sampleProvided || (rate != null && rate > 0)) && (
          <div className="ps-tags">
            {rate != null && rate > 0 && <span className="ps-tag">행사 특별가</span>}
            {sampleProvided && <span className="ps-tag">샘플 제공</span>}
          </div>
        )}
        {benefit && benefit !== "없음" && <div className="ps-benefit">{benefit}</div>}
      </div>
    </div>
  );
}
