export class DataForSEOError extends Error {
  readonly httpStatus: number | undefined;
  readonly endpoint: string;
  readonly retriable: boolean;
  readonly responseBody: unknown;

  constructor(
    message: string,
    args: {
      httpStatus?: number;
      endpoint: string;
      retriable: boolean;
      responseBody?: unknown;
    },
  ) {
    super(message);
    this.name = "DataForSEOError";
    this.httpStatus = args.httpStatus;
    this.endpoint = args.endpoint;
    this.retriable = args.retriable;
    this.responseBody = args.responseBody;
  }
}
