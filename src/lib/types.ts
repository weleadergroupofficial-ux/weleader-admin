// 공용 타입 (클라이언트·서버 공통)

export const MAX_PRODUCTS = 3;
export const MAX_GIFTS = 10;
export const MAX_PRICE = 100_000_000;
export const MAX_QUANTITY = 100_000;

export interface Product {
  name: string;
  regularPrice: number;
  eventPrice: number;
  sampleProvided: boolean;
  extraBenefit: string;
}

export interface Gift {
  name: string;
  quantity: number;
  unitPrice: number;
}

/** 제출 입력값 (검증 통과 후) */
export interface SubmissionInput {
  companyName: string;
  products: Product[];
  luckyDrawProvided: boolean;
  gifts: Gift[];
}

/** DB 에 저장된 제출 정보 */
export interface Submission extends SubmissionInput {
  id: string;
  revision: number;
  firstSubmittedAt: string;
  updatedAt: string;
  updatedBy: "company" | "admin";
}

/** 작성 중인 폼 상태 (빈 값 허용) */
export interface ProductDraft {
  name: string;
  regularPrice: number | null;
  eventPrice: number | null;
  sampleProvided: boolean | null;
  extraBenefit: string;
}
export interface GiftDraft {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
}
export interface SubmissionDraft {
  companyName: string;
  products: ProductDraft[];
  luckyDrawProvided: boolean | null;
  gifts: GiftDraft[];
}

export interface AdminCompany {
  id: string;
  name: string;
  token: string;
  sortOrder: number;
  isLocked: boolean;
  createdAt: string;
  verifyCode: string | null;
  submission: Submission | null;
}

export interface AdminOverview {
  settings: { submissionOpen: boolean; updatedAt: string };
  companies: AdminCompany[];
}

export interface PublicSubmitState {
  company: { name: string; isLocked: boolean };
  submissionOpen: boolean;
  submission: Submission | null;
}

export interface AuditLog {
  id: number;
  companyId: string | null;
  companyName: string | null;
  action: string;
  actor: "company" | "admin";
  detail: Record<string, unknown>;
  createdAt: string;
}

export type FieldErrors = Record<string, string>;
