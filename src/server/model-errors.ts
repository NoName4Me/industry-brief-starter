const MAX_DETAIL_LENGTH = 600;

export type ModelFailureKind = 'upstream' | 'network' | 'timeout';

type ModelFailure = Error & {
  modelFailure?: {
    kind: ModelFailureKind;
    upstreamStatus?: number;
  };
};

export function redactModelError(value: string, secret?: string) {
  let text = value;
  if (secret) text = text.split(secret).join('[已隐藏]');
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|ak|key)-[A-Za-z0-9_-]{8,}\b/gi, '[已隐藏]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
}

function upstreamMessage(raw: string) {
  try {
    const body = JSON.parse(raw) as {
      error?: string | { message?: unknown; detail?: unknown };
      message?: unknown;
      detail?: unknown;
    };
    const candidates = [
      typeof body.error === 'string' ? body.error : body.error?.message,
      body.error && typeof body.error === 'object' ? body.error.detail : undefined,
      body.message,
      body.detail,
    ];
    return candidates.find((value): value is string => typeof value === 'string' && !!value.trim());
  } catch {
    return undefined;
  }
}

export async function modelHttpFailure(response: Response, prefix: string, secret?: string) {
  const raw = await response.text().catch(() => '');
  const detail = redactModelError(upstreamMessage(raw) ?? raw, secret);
  const error = Object.assign(
    new Error(`${prefix}：HTTP ${response.status}${detail ? ` · ${detail}` : ''}`),
    {
      status: response.status,
      modelFailure: { kind: 'upstream', upstreamStatus: response.status } satisfies {
        kind: ModelFailureKind;
        upstreamStatus: number;
      },
    },
  ) as ModelFailure;
  return error;
}

export function modelTransportFailure(
  error: unknown,
  endpoint: string,
  prefix: string,
  secret?: string,
) {
  const cause =
    error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: { code?: unknown; message?: unknown } }).cause
      : undefined;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const timedOut =
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) ||
    (error instanceof Error && /timed? out|timeout/i.test(error.message));
  const reason = error instanceof Error ? redactModelError(error.message, secret) : '未知网络错误';
  const detail = redactModelError(
    `${timedOut ? '请求超时' : '无法连接'} ${endpoint}${reason && reason !== 'fetch failed' ? `：${reason}` : ''}${code ? `（${code}）` : ''}`,
    secret,
  );
  const failure = new Error(`${prefix}：${detail}`, { cause: error });
  return Object.assign(failure, {
    modelFailure: {
      kind: timedOut ? 'timeout' : 'network',
    } satisfies { kind: ModelFailureKind },
  }) as ModelFailure;
}

export function modelFailureKind(error: unknown) {
  return error && typeof error === 'object' && 'modelFailure' in error
    ? (error as ModelFailure).modelFailure?.kind
    : undefined;
}

export function modelFailureStatus(error: unknown) {
  const kind = modelFailureKind(error);
  return kind === 'timeout' ? 504 : kind ? 502 : 400;
}
