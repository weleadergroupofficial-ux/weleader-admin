"use client";

import { useId as useReactId, useRef, type ReactNode } from "react";

function useId(prefix: string) {
  return `${prefix}${useReactId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

interface BaseProps {
  label: ReactNode;
  q?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  id?: string;
}

function Label({ htmlFor, label, q, required }: { htmlFor?: string; label: ReactNode; q?: string; required?: boolean }) {
  const content = (
    <>
      {q && <span className="q">{q}</span>}
      <span>{label}</span>
      {required && (
        <span className="req" aria-hidden="true">
          *
        </span>
      )}
      {required && <span className="sr-only">(필수)</span>}
    </>
  );
  return htmlFor ? (
    <label className="field-label" htmlFor={htmlFor}>
      {content}
    </label>
  ) : (
    <span className="field-label">{content}</span>
  );
}

export function TextField(
  props: BaseProps & {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    maxLength?: number;
    multiline?: boolean;
    extra?: ReactNode;
  },
) {
  const autoId = useId("f");
  const id = props.id ?? autoId;
  const errId = `${id}-err`;
  const common = {
    id,
    value: props.value,
    placeholder: props.placeholder,
    maxLength: props.maxLength,
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby": props.error ? errId : undefined,
    "data-field": "",
  };
  return (
    <div className={`field${props.error ? " invalid" : ""}`}>
      <Label htmlFor={id} label={props.label} q={props.q} required={props.required} />
      {props.hint && <p className="field-hint">{props.hint}</p>}
      {props.multiline ? (
        <textarea className="textarea" rows={2} {...common} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input className="input" type="text" autoComplete="off" {...common} onChange={(e) => props.onChange(e.target.value)} />
      )}
      {props.extra}
      {props.error && (
        <p className="field-error" id={errId}>
          {props.error}
        </p>
      )}
    </div>
  );
}

const fmt = new Intl.NumberFormat("ko-KR");

/** 숫자 입력 (천 단위 쉼표 자동 표시) */
export function NumberField(
  props: BaseProps & {
    value: number | null;
    onChange: (v: number | null) => void;
    suffix: string;
    placeholder?: string;
    maxDigits?: number;
    extra?: ReactNode;
  },
) {
  const autoId = useId("n");
  const id = props.id ?? autoId;
  const errId = `${id}-err`;
  const inputRef = useRef<HTMLInputElement>(null);
  const maxDigits = props.maxDigits ?? 9;

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const caret = el.selectionStart ?? el.value.length;
    const digitsBeforeCaret = el.value.slice(0, caret).replace(/\D/g, "").length;
    const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, maxDigits);
    const next = digits === "" ? null : Number(digits);
    props.onChange(next);
    // 쉼표가 들어가도 커서 위치 유지
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      const v = input.value;
      let seen = 0;
      let pos = 0;
      while (pos < v.length && seen < digitsBeforeCaret) {
        if (/\d/.test(v[pos])) seen++;
        pos++;
      }
      input.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className={`field${props.error ? " invalid" : ""}`}>
      <Label htmlFor={id} label={props.label} q={props.q} required={props.required} />
      {props.hint && <p className="field-hint">{props.hint}</p>}
      <div className="input-wrap">
        <input
          ref={inputRef}
          id={id}
          className="input has-suffix num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={props.placeholder}
          value={props.value == null ? "" : fmt.format(props.value)}
          onChange={handle}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? errId : undefined}
          data-field=""
        />
        <span className="input-suffix" aria-hidden="true">
          {props.suffix}
        </span>
      </div>
      {props.extra}
      {props.error && (
        <p className="field-error" id={errId}>
          {props.error}
        </p>
      )}
    </div>
  );
}

export function ChoiceField(
  props: BaseProps & {
    value: boolean | null;
    onChange: (v: boolean) => void;
    yes?: string;
    no?: string;
    name: string;
  },
) {
  const autoId = useId("c");
  const errId = `${autoId}-err`;
  const opts: Array<[boolean, string]> = [
    [true, props.yes ?? "제공함"],
    [false, props.no ?? "제공하지 않음"],
  ];
  return (
    <div className={`field${props.error ? " invalid" : ""}`} role="radiogroup" aria-labelledby={`${autoId}-l`} aria-describedby={props.error ? errId : undefined}>
      <span id={`${autoId}-l`}>
        <Label label={props.label} q={props.q} required={props.required} />
      </span>
      {props.hint && <p className="field-hint">{props.hint}</p>}
      <div className="choice-row">
        {opts.map(([v, text]) => (
          <label key={String(v)} className={`choice${props.value === v ? " checked" : ""}`}>
            <input type="radio" name={props.name} checked={props.value === v} onChange={() => props.onChange(v)} data-field="" />
            <span className="dot" aria-hidden="true" />
            {text}
          </label>
        ))}
      </div>
      {props.error && (
        <p className="field-error" id={errId}>
          {props.error}
        </p>
      )}
    </div>
  );
}

export function Spinner({ label = "불러오는 중" }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </span>
  );
}

export function WaveLine() {
  return (
    <svg className="wave-line" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 7 C 12.5 0, 12.5 0, 25 7 S 37.5 14, 50 7 S 62.5 0, 75 7 S 87.5 14, 100 7 S 112.5 0, 125 7 S 137.5 14, 150 7 S 162.5 0, 175 7 S 187.5 14, 200 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="wordmark" aria-label="BEAUTY WAVE in INCHEON 2026">
      <span className="wm-main" aria-hidden="true">
        BEAUTY WAVE
      </span>
      <span className="wm-sub" aria-hidden="true">
        in INCHEON 2026
        <WaveLine />
      </span>
    </div>
  );
}
