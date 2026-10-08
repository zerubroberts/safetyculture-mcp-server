import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures synthetic: no real organisation data.
describe("sensors toolset", () => {
  it("lists sensors with source IDs and placement", async () => {
    const api = new MockApi().on("POST /sensors/v1/sensors/list", {
      sensors: [
        {
          source_name: "demo-prov",
          source_id: "sensor-1",
          asset_id: "asset-1",
          asset_name: "Demo Fridge",
          asset_timezone: "Australia/Melbourne",
          location_name: "Demo Depot coolroom",
          site_id: "site-1",
        },
      ],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_sensors", {});
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/sensors/v1/sensors/list", body: { page_size: 50 } });
    expect(json(res.text).sensors).toEqual([
      {
        source_name: "demo-prov",
        source_id: "sensor-1",
        asset: { id: "asset-1", name: "Demo Fridge" },
        site_id: "site-1",
        location: "Demo Depot coolroom",
        timezone: "Australia/Melbourne",
      },
    ]);
  });

  it("gets latest readings for one sensor, preferring the alias", async () => {
    const api = new MockApi().on("GET ^/sensors/v1/sensors/[^/]+/[^/]+/latest-readings$", {
      readings: [
        { timestamp: "2026-10-08T00:00:00Z", name: "Temperature", type: "temperature", value: "4.10", unit: "Celsius", alias: "Fridge temp" },
        { timestamp: "2026-10-08T00:00:00Z", name: "Relative Humidity", type: "relative_humidity", value: "60", unit: "Percentage" },
      ],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_sensor_readings", { source_name: "demo-prov", source_id: "sensor-1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/sensors/v1/sensors/demo-prov/sensor-1/latest-readings" });
    expect(json(res.text).readings).toEqual([
      { name: "Fridge temp", type: "temperature", value: "4.10", unit: "Celsius", timestamp: "2026-10-08T00:00:00Z" },
      { name: "Relative Humidity", type: "relative_humidity", value: "60", unit: "Percentage", timestamp: "2026-10-08T00:00:00Z" },
    ]);
  });
});
