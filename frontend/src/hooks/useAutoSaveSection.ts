import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type AutoSaveOptions<T> = {
  value: T;
  signature: string;
  enabled: boolean;
  resetVersion: number;
  save: (value: T) => Promise<void>;
  validate?: (value: T) => string | null;
  delay?: number;
};

type AutoSaveResult = {
  status: AutoSaveStatus;
  error: string | null;
  isDirty: boolean;
  flush: () => Promise<boolean>;
  retry: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAutoSaveSection<T>({
  value,
  signature,
  enabled,
  resetVersion,
  save,
  validate,
  delay = 800
}: AutoSaveOptions<T>): AutoSaveResult {
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  const signatureRef = useRef(signature);
  const savedSignatureRef = useRef<string | null>(null);
  const saveRef = useRef(save);
  const validateRef = useRef(validate);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  valueRef.current = value;
  signatureRef.current = signature;
  saveRef.current = save;
  validateRef.current = validate;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = null;

    if (!enabled || resetVersion === 0) {
      savedSignatureRef.current = null;
      setSavedSignature(null);
      setStatus("idle");
      setError(null);
      return;
    }

    savedSignatureRef.current = signatureRef.current;
    setSavedSignature(signatureRef.current);
    setStatus("idle");
    setError(null);
  }, [enabled, resetVersion]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (!enabled || savedSignatureRef.current === null) return true;

    while (signatureRef.current !== savedSignatureRef.current) {
      const existing = inFlightRef.current;
      if (existing) {
        if (!(await existing)) return false;
        continue;
      }

      const targetValue = valueRef.current;
      const targetSignature = signatureRef.current;
      const validationError = validateRef.current?.(targetValue) || null;
      if (validationError) {
        if (mountedRef.current) {
          setStatus("error");
          setError(validationError);
        }
        return false;
      }

      const generation = generationRef.current;
      const job = (async () => {
        if (mountedRef.current) {
          setStatus("saving");
          setError(null);
        }

        try {
          await saveRef.current(targetValue);
        } catch (saveError) {
          if (mountedRef.current && generation === generationRef.current) {
            setStatus("error");
            setError(errorMessage(saveError));
          }
          return false;
        }

        if (mountedRef.current && generation === generationRef.current) {
          savedSignatureRef.current = targetSignature;
          setSavedSignature(targetSignature);
          setStatus(
            signatureRef.current === targetSignature ? "saved" : "dirty"
          );
        }
        return true;
      })();

      inFlightRef.current = job;
      const succeeded = await job;
      if (inFlightRef.current === job) inFlightRef.current = null;
      if (!succeeded) return false;
    }

    return true;
  }, [enabled]);

  useEffect(() => {
    if (
      !enabled ||
      savedSignature === null ||
      signature === savedSignature
    ) {
      return;
    }

    setStatus((current) => current === "saving" ? current : "dirty");
    setError(null);
    const timer = window.setTimeout(() => {
      void flush();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay, enabled, flush, savedSignature, signature]);

  return {
    status,
    error,
    isDirty: savedSignature !== null && signature !== savedSignature,
    flush,
    retry: () => {
      void flush();
    }
  };
}
