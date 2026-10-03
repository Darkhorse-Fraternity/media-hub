import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";

import { mediaHubSignInSchema } from "@acme/validators";

import { authClient } from "~/auth/client";

export function SessionLoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-slate-100">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className="size-2 animate-pulse rounded-full bg-cyan-300" />
        正在检查登录状态…
      </div>
    </main>
  );
}

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [loginError, setLoginError] = useState<string | null>(null);
  const formElementRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onChange: mediaHubSignInSchema,
      onSubmit: mediaHubSignInSchema,
    },
    onSubmit: async ({ value }) => {
      setLoginError(null);
      try {
        const result = await authClient.signIn.email({
          email: value.email.trim(),
          password: value.password,
          rememberMe: true,
        });
        if (result.error) {
          setLoginError(
            result.error.message ?? "账号或密码不正确，请检查后重试。",
          );
          return;
        }
        onSuccess();
      } catch (error) {
        setLoginError(
          error instanceof Error ? error.message : "登录失败，请重试。",
        );
      }
    },
  });

  useEffect(() => {
    const syncAutofill = () => {
      const formElement = formElementRef.current;
      const emailInput = formElement?.elements.namedItem("email");
      const passwordInput = formElement?.elements.namedItem("password");

      if (
        emailInput instanceof HTMLInputElement &&
        emailInput.value !== form.getFieldValue("email")
      ) {
        form.setFieldValue("email", emailInput.value);
      }
      if (
        passwordInput instanceof HTMLInputElement &&
        passwordInput.value !== form.getFieldValue("password")
      ) {
        form.setFieldValue("password", passwordInput.value);
      }
    };

    const timers = [0, 100, 500, 1000].map((delay) =>
      window.setTimeout(syncAutofill, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [form]);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md">
        <div className="mb-7">
          <p className="text-xs font-semibold tracking-[0.24em] text-cyan-300">
            PUMPKII MEDIA HUB
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            登录导演台
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            使用管理员分配的账号，开始创作和管理视频。
          </p>
        </div>
        <form
          ref={formElementRef}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
          className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30"
        >
          <form.Field
            name="email"
            children={(field) => {
              const errorMessage = field.state.meta.isTouched
                ? getFormErrorMessage(field.state.meta.errors[0])
                : null;
              return (
                <label className="block text-sm text-slate-300">
                  邮箱
                  <input
                    type="email"
                    name={field.name}
                    autoComplete="username"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onInput={(event) => {
                      setLoginError(null);
                      field.handleChange(event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      setLoginError(null);
                      field.handleChange(event.target.value);
                    }}
                    placeholder="name@pumpkii.com"
                    aria-invalid={!!errorMessage}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15 aria-invalid:border-rose-400"
                  />
                  {errorMessage && (
                    <span className="mt-1.5 block text-xs text-rose-300">
                      {errorMessage}
                    </span>
                  )}
                </label>
              );
            }}
          />
          <form.Field
            name="password"
            children={(field) => {
              const errorMessage = field.state.meta.isTouched
                ? getFormErrorMessage(field.state.meta.errors[0])
                : null;
              return (
                <label className="mt-4 block text-sm text-slate-300">
                  密码
                  <input
                    type="password"
                    name={field.name}
                    autoComplete="current-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onInput={(event) => {
                      setLoginError(null);
                      field.handleChange(event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      setLoginError(null);
                      field.handleChange(event.target.value);
                    }}
                    placeholder="至少 6 位"
                    aria-invalid={!!errorMessage}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15 aria-invalid:border-rose-400"
                  />
                  {errorMessage && (
                    <span className="mt-1.5 block text-xs text-rose-300">
                      {errorMessage}
                    </span>
                  )}
                </label>
              );
            }}
          />
          {loginError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs leading-5 text-rose-300"
            >
              {loginError}
            </p>
          )}
          <form.Subscribe
            selector={(state) => [state.values, state.isSubmitting] as const}
            children={([values, isSubmitting]) => {
              const isValid = mediaHubSignInSchema.safeParse(values).success;
              return (
                <button
                  type="submit"
                  disabled={!isValid || isSubmitting}
                  className="mt-5 w-full rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? "正在登录…" : "登录导演台"}
                </button>
              );
            }}
          />
        </form>
      </div>
    </main>
  );
}

function getFormErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}
