import { z } from "zod";
import { P } from "../core/params.js";
import { defineTool } from "../core/registry.js";

/**
 * Sensors and readings.
 * Contracts verified against the cached API reference 2026-10-08
 * (sensorsservice_listsensors, sensorsservice_getsensorlatestreadings).
 */

interface RawSensor {
  source_name?: string;
  source_id?: string;
  asset_id?: string;
  asset_name?: string;
  asset_timezone?: string;
  location_name?: string;
  site_id?: string;
}

interface RawReading {
  timestamp?: string;
  name?: string;
  type?: string;
  value?: string;
  unit?: string;
  raw_value?: string;
  raw_unit?: string;
  alias?: string;
}

export const sensorsTools = [
  defineTool({
    name: "sc_list_sensors",
    title: "List sensors",
    toolset: "sensors",
    access: "read",
    description:
      "Lists every sensor in the organisation with its source IDs, linked asset, site, location label and timezone. Use the source_name and source_id with sc_get_sensor_readings.",
    input: {
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ sensors?: RawSensor[]; next_page_token?: string }>("/sensors/v1/sensors/list", {
        page_size: a.limit ?? 50,
        page_token: a.page_token,
      });
      const rows = (res.sensors ?? []).map((s) => ({
        source_name: s.source_name,
        source_id: s.source_id,
        asset: s.asset_id || s.asset_name ? { id: s.asset_id, name: s.asset_name } : undefined,
        site_id: s.site_id,
        location: s.location_name,
        timezone: s.asset_timezone,
      }));
      return {
        summary: `${rows.length} sensors.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { sensors: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_sensor_readings",
    title: "Get sensor readings",
    toolset: "sensors",
    access: "read",
    description:
      "Returns the latest readings for one sensor (temperature, humidity and any other channels), each with value, unit and timestamp. Find sensors with sc_list_sensors.",
    input: {
      source_name: z.string().describe("Sensor source (provider/origin), from sc_list_sensors."),
      source_id: z.string().describe("Sensor source ID, from sc_list_sensors."),
    },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{ readings?: RawReading[] }>(
        `/sensors/v1/sensors/${encodeURIComponent(a.source_name)}/${encodeURIComponent(a.source_id)}/latest-readings`,
      );
      const rows = (res.readings ?? []).map((r) => ({
        name: r.alias || r.name,
        type: r.type,
        value: r.value,
        unit: r.unit,
        timestamp: r.timestamp,
      }));
      return {
        summary: `${rows.length} latest readings for sensor ${a.source_name}/${a.source_id}.`,
        data: { source_name: a.source_name, source_id: a.source_id, readings: rows },
        untrusted: true,
      };
    },
  }),
];
