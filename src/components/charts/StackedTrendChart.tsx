"use client";

import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

const CATEGORY_COLORS: Record<string, string> = {
  "Heavy Oil":  "#003C71",
  "Light Oil":  "#4A6F94",
  "Coolant":    "#E1261C",
  "WW":         "#F59E0B",
  "DEF":        "#6B7280",
  "Other":      "#9CA3AF",
};

export type StackedTrendRow = {
  month: string;
  [category: string]: string | number;
};

export function StackedTrendChart({
  data,
  categories,
}: {
  data: StackedTrendRow[];
  categories: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#374151" }} />
        <YAxis
          tick={{ fontSize: 11, fill: "#374151" }}
          tickFormatter={(v: number) => v.toLocaleString()}
        />
        <Tooltip
          formatter={(value: number) => [value.toLocaleString() + " gal", ""]}
          contentStyle={{ fontSize: 12, borderRadius: 2 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {categories.map((cat) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="vol"
            fill={CATEGORY_COLORS[cat] ?? "#9CA3AF"}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
