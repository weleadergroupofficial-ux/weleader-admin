"use client";

import { discountRate, formatNumber, formatWon, giftSummary, giftTotal } from "@/lib/calc";
import { MAX_GIFTS, MAX_PRODUCTS, type FieldErrors, type GiftDraft, type ProductDraft, type SubmissionDraft } from "@/lib/types";
import { emptyGift, emptyProduct } from "@/lib/validation";
import { PriceSign } from "./PriceSign";
import { ChoiceField, NumberField, TextField } from "./ui/fields";

/** 참가업체 입력 폼 본문 (참가업체 페이지와 관리자 수정 화면 공용) */
export function SubmissionEditor({
  value,
  onChange,
  errors,
}: {
  value: SubmissionDraft;
  onChange: (v: SubmissionDraft) => void;
  errors: FieldErrors;
}) {
  const setProduct = (i: number, patch: Partial<ProductDraft>) =>
    onChange({ ...value, products: value.products.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setGift = (i: number, patch: Partial<GiftDraft>) =>
    onChange({ ...value, gifts: value.gifts.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  const gs = giftSummary(value.gifts);

  return (
    <>
      <section className="section" aria-labelledby="sec1">
        <div className="section-head">
          <div className="section-no">SECTION 01</div>
          <h2 className="section-title" id="sec1">
            참가업체 기본정보
          </h2>
        </div>
        <TextField
          q="Q1"
          label="참가업체명"
          required
          value={value.companyName}
          onChange={(v) => onChange({ ...value, companyName: v })}
          placeholder="예) 주식회사 ○○뷰티"
          maxLength={100}
          hint="가격 안내판과 럭키드로우 안내에 표시되는 이름입니다. 정식 명칭으로 확인해 주세요."
          error={errors.companyName}
        />
      </section>

      <section className="section" aria-labelledby="sec2">
        <div className="section-head">
          <div className="section-no">SECTION 02</div>
          <h2 className="section-title" id="sec2">
            부스별 상품 가격 안내판 정보
          </h2>
          <p className="section-desc">
            행사장 내 업체별 가격 안내판 제작에 사용됩니다. 대표 판매상품은 최대 {MAX_PRODUCTS}개까지 등록할 수 있어요.
          </p>
        </div>
        {errors.products && <p className="field-error">{errors.products}</p>}

        {value.products.map((p, i) => {
          const k = `products.${i}`;
          const rate = discountRate(p.regularPrice, p.eventPrice);
          return (
            <div className="item-card" key={i}>
              <div className="item-head">
                <span className="item-title">대표 판매상품 {i + 1}</span>
                {value.products.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onChange({ ...value, products: value.products.filter((_, j) => j !== i) })}
                  >
                    이 상품 삭제
                  </button>
                )}
              </div>
              <div className="product-layout">
                <div className="item-grid">
                  <TextField
                    q="Q2"
                    label="대표 판매상품명"
                    required
                    value={p.name}
                    onChange={(v) => setProduct(i, { name: v })}
                    placeholder="예) 프리미엄 수분 앰플 30ml"
                    maxLength={100}
                    error={errors[`${k}.name`]}
                  />
                  <div className="two-col">
                    <NumberField
                      q="Q3"
                      label="정상 판매가"
                      required
                      suffix="원"
                      value={p.regularPrice}
                      onChange={(v) => setProduct(i, { regularPrice: v })}
                      placeholder="30,000"
                      error={errors[`${k}.regularPrice`]}
                    />
                    <NumberField
                      q="Q4"
                      label="행사 특별 할인가"
                      required
                      suffix="원"
                      value={p.eventPrice}
                      onChange={(v) => setProduct(i, { eventPrice: v })}
                      placeholder="21,000"
                      error={errors[`${k}.eventPrice`]}
                    />
                  </div>
                  <div className="rate-line" aria-live="polite">
                    {rate != null ? (
                      <>
                        <span className={`rate-pill${rate === 0 ? " zero" : ""}`}>{rate === 0 ? "할인 없음" : `${rate}% 할인`}</span>
                        {rate > 0 && <span className="num">{formatNumber((p.regularPrice ?? 0) - (p.eventPrice ?? 0))}원 저렴해요</span>}
                      </>
                    ) : (
                      <span>할인이 없으면 정상가와 같은 금액을 입력하세요. 할인율은 자동으로 계산됩니다.</span>
                    )}
                    {p.regularPrice != null && p.eventPrice == null && (
                      <button type="button" className="chip-btn" onClick={() => setProduct(i, { eventPrice: p.regularPrice })}>
                        정상가와 동일
                      </button>
                    )}
                  </div>
                  <ChoiceField
                    q="Q5"
                    label="샘플 제공 여부"
                    required
                    name={`sample-${i}`}
                    value={p.sampleProvided}
                    onChange={(v) => setProduct(i, { sampleProvided: v })}
                    error={errors[`${k}.sampleProvided`]}
                  />
                  <TextField
                    q="Q6"
                    label="추가 이벤트 혜택"
                    required
                    multiline
                    value={p.extraBenefit}
                    onChange={(v) => setProduct(i, { extraBenefit: v })}
                    placeholder="예) 2개 구매 시 1개 증정 / 3만원 이상 구매 시 사은품 제공"
                    maxLength={300}
                    hint="해당 사항이 없으면 '없음'을 입력하세요."
                    extra={
                      p.extraBenefit.trim() === "" ? (
                        <div>
                          <button type="button" className="chip-btn" onClick={() => setProduct(i, { extraBenefit: "없음" })}>
                            없음
                          </button>
                        </div>
                      ) : null
                    }
                    error={errors[`${k}.extraBenefit`]}
                  />
                </div>
                <div className="sign-col">
                  <p className="sign-caption">가격 안내판 미리보기</p>
                  <PriceSign
                    company={value.companyName}
                    index={i + 1}
                    name={p.name}
                    regularPrice={p.regularPrice}
                    eventPrice={p.eventPrice}
                    sampleProvided={p.sampleProvided}
                    extraBenefit={p.extraBenefit}
                  />
                </div>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          className="add-btn"
          disabled={value.products.length >= MAX_PRODUCTS}
          onClick={() => onChange({ ...value, products: [...value.products, emptyProduct()] })}
        >
          {value.products.length >= MAX_PRODUCTS
            ? `대표 판매상품은 최대 ${MAX_PRODUCTS}개까지 등록할 수 있습니다`
            : `+ 상품 추가하기 (${value.products.length}/${MAX_PRODUCTS})`}
        </button>
      </section>

      <section className="section" aria-labelledby="sec3">
        <div className="section-head">
          <div className="section-no">SECTION 03</div>
          <h2 className="section-title" id="sec3">
            럭키드로우 기프트 제공 정보
          </h2>
          <p className="section-desc">행사에서 제공할 럭키드로우 경품 정보를 알려주세요.</p>
        </div>
        <ChoiceField
          q="Q7"
          label="럭키드로우 제공 여부"
          required
          name="lucky"
          value={value.luckyDrawProvided}
          onChange={(v) =>
            onChange({ ...value, luckyDrawProvided: v, gifts: v && value.gifts.length === 0 ? [emptyGift()] : value.gifts })
          }
          error={errors.luckyDrawProvided}
        />

        {value.luckyDrawProvided && (
          <div style={{ marginTop: 20 }}>
            {errors.gifts && <p className="field-error">{errors.gifts}</p>}
            {value.gifts.map((g, i) => {
              const k = `gifts.${i}`;
              return (
                <div className="item-card" key={i}>
                  <div className="item-head">
                    <span className="item-title">경품 {i + 1}</span>
                    {value.gifts.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onChange({ ...value, gifts: value.gifts.filter((_, j) => j !== i) })}
                      >
                        이 경품 삭제
                      </button>
                    )}
                  </div>
                  <div className="item-grid">
                    <TextField
                      q="Q8"
                      label="제공 상품명"
                      required
                      value={g.name}
                      onChange={(v) => setGift(i, { name: v })}
                      placeholder="예) 프리미엄 수분 앰플 30ml"
                      maxLength={100}
                      error={errors[`${k}.name`]}
                    />
                    <div className="two-col">
                      <NumberField
                        q="Q9"
                        label="제공 수량"
                        required
                        suffix="개"
                        maxDigits={6}
                        value={g.quantity}
                        onChange={(v) => setGift(i, { quantity: v })}
                        placeholder="30"
                        error={errors[`${k}.quantity`]}
                      />
                      <NumberField
                        q="Q10"
                        label="정상 판매가 (1개 기준)"
                        required
                        suffix="원"
                        value={g.unitPrice}
                        onChange={(v) => setGift(i, { unitPrice: v })}
                        placeholder="25,000"
                        error={errors[`${k}.unitPrice`]}
                      />
                    </div>
                    <div className="gift-line-total num">
                      {formatNumber(g.quantity ?? 0)}개 × {formatWon(g.unitPrice ?? 0)} = <b>{formatWon(giftTotal(g))}</b>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="add-btn"
              disabled={value.gifts.length >= MAX_GIFTS}
              onClick={() => onChange({ ...value, gifts: [...value.gifts, emptyGift()] })}
            >
              {value.gifts.length >= MAX_GIFTS ? `경품은 최대 ${MAX_GIFTS}종까지 등록할 수 있습니다` : "+ 경품 추가하기"}
            </button>
            <dl className="gift-total" aria-live="polite">
              <div>
                <dt>경품 종류</dt>
                <dd className="num">{gs.kinds}종</dd>
              </div>
              <div>
                <dt>총 제공 수량</dt>
                <dd className="num">{formatNumber(gs.quantity)}개</dd>
              </div>
              <div>
                <dt>정상가 기준 총금액</dt>
                <dd className="num">{formatWon(gs.amount)}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </>
  );
}
