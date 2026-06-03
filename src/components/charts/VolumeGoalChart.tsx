"use client";

/**
 * VolumeGoalChart — billed volume (navy bars) vs monthly goal (orange dashed
 * line, = working days × daily target). The signature chart of the redesign.
 */
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export type VolumeGoalPoint = {
  month: string;
  billed: number;
  goal: number | null;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function VolumeGoalChart({ data }: { data: VolumeGoalPoint[] }) {
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#EEF1F5" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "#8A95A3" }}
            axisLine={{ stroke: "#E6E9EE" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#8A95A3" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
          />
          <Tooltip
            formatter={(value, name) => [fmt(Number(value)) + " gal", name === "billed" ? "Billed" : "Goal"]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E6E9EE" }}
          />
          <Bar dataKey="billed" name="billed" fill="#15385D" radius={[3, 3, 0, 0]} barSize={22} />
          <Line
            dataKey="goal"
            name="goal"
            stroke="#ED8B00"
            strokeWidth={2.5}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
