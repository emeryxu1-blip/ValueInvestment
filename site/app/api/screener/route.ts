import { jsonResponse, routeError } from "../../../lib/http";
import { getScreenerResponse } from "../../../lib/screener/service";
import { parseScreenerSearchParams } from "../../../lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = parseScreenerSearchParams(new URL(request.url).searchParams);
    const result = await getScreenerResponse(query);
    return jsonResponse(result.response, { status: result.status });
  } catch (error) {
    return routeError(error);
  }
}
