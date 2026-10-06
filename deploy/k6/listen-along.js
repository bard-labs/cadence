import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
};

const base = __ENV.CADENCE_API_URL || "http://localhost:8080";

export default function () {
  const res = http.get(`${base}/healthz`);
  check(res, { "health ok": (r) => r.status === 200 });
  sleep(1);
}
