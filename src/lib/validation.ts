import {
  MAX_GIFTS,
  MAX_PRICE,
  MAX_PRODUCTS,
  MAX_QUANTITY,
  type FieldErrors,
  type Gift,
  type Product,
  type Submission,
  type SubmissionDraft,
  type SubmissionInput,
} from "./types";

/**
 * 제출값 검증. 클라이언트(즉시 안내)와 서버(최종 검증)가 같은 규칙을 사용합니다.
 * 서버에서는 신뢰할 수 없는 JSON 이 그대로 들어오므로 타입부터 확인합니다.
 */
export type ValidationResult =
  | { ok: true; value: SubmissionInput }
  | { ok: false; errors: FieldErrors };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // 제어문자 제거 (줄바꿈·탭은 공백으로)
  return v.replace(/[\t\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  return null;
}

export function validateSubmission(raw: unknown): ValidationResult {
  const errors: FieldErrors = {};
  if (!isObj(raw)) return { ok: false, errors: { _form: "제출 형식이 올바르지 않습니다." } };

  const companyName = text(raw.companyName) ?? "";
  if (!companyName) errors.companyName = "참가업체명을 입력해 주세요.";
  else if (companyName.length > 100) errors.companyName = "참가업체명은 100자 이내로 입력해 주세요.";

  const rawProducts = Array.isArray(raw.products) ? raw.products : [];
  if (rawProducts.length < 1) errors.products = "대표 판매상품을 1개 이상 입력해 주세요.";
  if (rawProducts.length > MAX_PRODUCTS) errors.products = `대표 판매상품은 최대 ${MAX_PRODUCTS}개까지 등록할 수 있습니다.`;

  const products: Product[] = [];
  rawProducts.slice(0, MAX_PRODUCTS).forEach((p, i) => {
    const k = `products.${i}`;
    const o = isObj(p) ? p : {};
    const name = text(o.name) ?? "";
    const regularPrice = int(o.regularPrice);
    const eventPrice = int(o.eventPrice);
    const sample = typeof o.sampleProvided === "boolean" ? o.sampleProvided : null;
    const extraBenefit = text(o.extraBenefit) ?? "";

    if (!name) errors[`${k}.name`] = "상품명을 입력해 주세요.";
    else if (name.length > 100) errors[`${k}.name`] = "상품명은 100자 이내로 입력해 주세요.";

    if (regularPrice == null) errors[`${k}.regularPrice`] = "정상 판매가를 입력해 주세요.";
    else if (regularPrice < 1 || regularPrice > MAX_PRICE) errors[`${k}.regularPrice`] = "정상 판매가는 1원 이상 1억 원 이하로 입력해 주세요.";

    if (eventPrice == null) errors[`${k}.eventPrice`] = "행사 특별 할인가를 입력해 주세요. 할인이 없으면 정상가와 같게 입력합니다.";
    else if (eventPrice < 0 || eventPrice > MAX_PRICE) errors[`${k}.eventPrice`] = "할인가는 0원 이상 1억 원 이하로 입력해 주세요.";
    else if (regularPrice != null && eventPrice > regularPrice) errors[`${k}.eventPrice`] = "할인가는 정상 판매가보다 높을 수 없습니다.";

    if (sample == null) errors[`${k}.sampleProvided`] = "샘플 제공 여부를 선택해 주세요.";

    if (!extraBenefit) errors[`${k}.extraBenefit`] = "추가 이벤트 혜택을 입력해 주세요. 해당 사항이 없으면 '없음'이라고 입력합니다.";
    else if (extraBenefit.length > 300) errors[`${k}.extraBenefit`] = "추가 이벤트 혜택은 300자 이내로 입력해 주세요.";

    products.push({
      name,
      regularPrice: regularPrice ?? 0,
      eventPrice: eventPrice ?? 0,
      sampleProvided: sample ?? false,
      extraBenefit,
    });
  });

  const lucky = typeof raw.luckyDrawProvided === "boolean" ? raw.luckyDrawProvided : null;
  if (lucky == null) errors.luckyDrawProvided = "럭키드로우 제공 여부를 선택해 주세요.";

  const gifts: Gift[] = [];
  if (lucky) {
    const rawGifts = Array.isArray(raw.gifts) ? raw.gifts : [];
    if (rawGifts.length < 1) errors.gifts = "제공할 경품을 1개 이상 입력해 주세요.";
    if (rawGifts.length > MAX_GIFTS) errors.gifts = `경품은 최대 ${MAX_GIFTS}종까지 등록할 수 있습니다.`;
    rawGifts.slice(0, MAX_GIFTS).forEach((g, i) => {
      const k = `gifts.${i}`;
      const o = isObj(g) ? g : {};
      const name = text(o.name) ?? "";
      const quantity = int(o.quantity);
      const unitPrice = int(o.unitPrice);
      if (!name) errors[`${k}.name`] = "제공 상품명을 입력해 주세요.";
      else if (name.length > 100) errors[`${k}.name`] = "제공 상품명은 100자 이내로 입력해 주세요.";
      if (quantity == null) errors[`${k}.quantity`] = "제공 수량을 입력해 주세요.";
      else if (quantity < 1 || quantity > MAX_QUANTITY) errors[`${k}.quantity`] = "제공 수량은 1개 이상 100,000개 이하로 입력해 주세요.";
      if (unitPrice == null) errors[`${k}.unitPrice`] = "정상 판매가(1개 기준)를 입력해 주세요.";
      else if (unitPrice < 0 || unitPrice > MAX_PRICE) errors[`${k}.unitPrice`] = "정상 판매가는 0원 이상 1억 원 이하로 입력해 주세요.";
      gifts.push({ name, quantity: quantity ?? 0, unitPrice: unitPrice ?? 0 });
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { companyName, products, luckyDrawProvided: lucky as boolean, gifts } };
}

export const emptyProduct = () => ({ name: "", regularPrice: null, eventPrice: null, sampleProvided: null, extraBenefit: "" });
export const emptyGift = () => ({ name: "", quantity: null, unitPrice: null });

export function draftFromSubmission(s: Submission | null, fallbackName: string): SubmissionDraft {
  if (!s) {
    return { companyName: fallbackName, products: [emptyProduct()], luckyDrawProvided: null, gifts: [emptyGift()] };
  }
  return {
    companyName: s.companyName,
    products: s.products.map((p) => ({ ...p })),
    luckyDrawProvided: s.luckyDrawProvided,
    gifts: s.gifts.length ? s.gifts.map((g) => ({ ...g })) : [emptyGift()],
  };
}

/** 제출 직전 전송용 값 (럭키드로우 미제공이면 경품 비움) */
export function draftToPayload(d: SubmissionDraft) {
  return {
    companyName: d.companyName,
    products: d.products,
    luckyDrawProvided: d.luckyDrawProvided,
    gifts: d.luckyDrawProvided ? d.gifts : [],
  };
}
