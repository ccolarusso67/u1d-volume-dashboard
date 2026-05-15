"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

export type MixRow = { package: string; gallons: number };

export function PackageMixChart({ data }: { data: MixRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 24, right: 10, left: 10, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis
          dataKey="package"
          tick={{ fontSize: 10, fill: "#374151" }}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#374151" }}
          tickFormatter={(v: number) => v.toLocaleString()}
        />
        <Tooltip
          formatter={(value: number) => [value.toLocaleString() + " gal", "Volume"]}
          contentStyle={{ fontSize: 12, borderRadius: 2 }}
        />
        <Bar dataKey="gallons" fill="#003C71">
          <LabelList
            dataKey="gallons"
            position="top"
            formatter={(v: number) => v.toLocaleString()}
            style={{ fontSize: 10, fill: "#003C71", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
