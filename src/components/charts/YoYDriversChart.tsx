"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

export type DriverRow = { package: string; delta: number };

export function YoYDriversChart({ data }: { data: DriverRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#374151" }}
          tickFormatter={(v: number) => "+" + v.toLocaleString()}
        />
        <YAxis
          type="category"
          dataKey="package"
          tick={{ fontSize: 11, fill: "#003C71" }}
          width={90}
        />
        <Tooltip
          formatter={(value: number) => ["+" + value.toLocaleString() + " gal", "Δ YoY"]}
          contentStyle={{ fontSize: 12, borderRadius: 2 }}
        />
        <Bar dataKey="delta" fill="#003C71">
          <LabelList
            dataKey="delta"
            position="right"
            formatter={(v: number) => "+" + v.toLocaleString()}
            style={{ fontSize: 11, fill: "#003C71", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
