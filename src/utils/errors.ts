export enum EasyPayErrorCode {
  INSUFFICIENT_FUNDS = 'ERR_INSUFFICIENT_FUNDS',
  CARD_DECLINED = 'ERR_CARD_DECLINED',
  GATEWAY_TIMEOUT = 'ERR_GATEWAY_TIMEOUT',
  INVALID_CREDENTIALS = 'ERR_INVALID_CREDENTIALS',
  PROVIDER_ERROR = 'ERR_PROVIDER_ERROR',
  UNKNOWN = 'ERR_UNKNOWN'
}

export class EasyPayError extends Error {
  public code: string;
  public providerRawError?: any;

  constructor(code: EasyPayErrorCode | string, message: string, providerRawError?: any) {
    super(message);
    this.name = 'EasyPayError';
    this.code = code;
    this.providerRawError = providerRawError;
    Object.setPrototypeOf(this, EasyPayError.prototype);
  }
}
