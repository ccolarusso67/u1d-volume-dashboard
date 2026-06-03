"use client";

/**
 * MixDonut — category share of gallons (latest period). Restrained palette:
 * navy → blue → orange → teal, matching the redesign system.
 */
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export const MIX_COLORS = ["#15385D", "#1C6FB8", "#ED8B00", "#5DCAA5", "#9FE1CB", "#8A95A3"];

export type MixSlice = { name: string; value: number };

export function MixDonut({ data }: { data: MixSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%"
            outerRadius="100%"
            paddingAngle={1}
            stroke="#fff"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={MIX_COLORS[i % MIX_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [
              `${Math.round(Number(v)).toLocaleString("en-US")} gal (${Math.round((Number(v) / total) * 100)}%)`,
              "",
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E6E9EE" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
