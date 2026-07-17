export interface ApiErrorResponse {
  code: string;
  details?: readonly string[];
  message: string;
  path: string;
  statusCode: number;
  timestamp: string;
}
