import React from "react";
import { Svg, Line, Rect, Circle, Text as SvgText, G, Polyline } from "@react-pdf/renderer";

export interface ChartDataPoint {
  label: string;
  value: number | null;
}

export interface InitiativeMarker {
  label: string;
  index: number;
}

interface TrendChartProps {
  data: ChartDataPoint[];
  baselineValue?: number;
  initiatives?: InitiativeMarker[];
  projectionStartIndex?: number;
  width?: number;
  height?: number;
}

const CHART_PADDING = { top: 20, right: 20, bottom: 30, left: 50 };

export function TrendChartSvg({
  data,
  baselineValue = 0,
  initiatives = [],
  projectionStartIndex,
  width = 500,
  height = 180,
}: TrendChartProps) {
  const plotW = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const validPoints = data
    .map((d, i) => (d.value != null ? { i, v: d.value } : null))
    .filter(Boolean) as { i: number; v: number }[];

  if (validPoints.length === 0) {
    return (
      <Svg width={width} height={height}>
        <SvgText
          x={width / 2}
          y={height / 2}
          style={{ fontSize: 10, color: "#999" }}
        >
          No snapshot data available
        </SvgText>
      </Svg>
    );
  }

  const allVals = validPoints.map((p) => p.v);
  if (baselineValue != null) allVals.push(baselineValue);
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  const yPad = Math.max(Math.abs(yMax - yMin) * 0.15, 5);
  yMin -= yPad;
  yMax += yPad;

  const xScale = (i: number) =>
    CHART_PADDING.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const yScale = (v: number) =>
    CHART_PADDING.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const mainPoints = validPoints.filter(
    (p) => projectionStartIndex == null || p.i < projectionStartIndex,
  );
  const projPoints = projectionStartIndex != null
    ? validPoints.filter((p) => p.i >= projectionStartIndex - 1)
    : [];

  const toPolyline = (pts: { i: number; v: number }[]) =>
    pts.map((p) => `${xScale(p.i)},${yScale(p.v)}`).join(" ");

  const baselineY = yScale(baselineValue);
  const gridLines = 4;
  const gridStep = (yMax - yMin) / gridLines;

  return (
    <Svg width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill="#FAFAFA" rx={4} />

      {Array.from({ length: gridLines + 1 }, (_, gi) => {
        const val = yMin + gi * gridStep;
        const gy = yScale(val);
        return (
          <React.Fragment key={`grid-${gi}`}>
            <G>
              <Line
                x1={CHART_PADDING.left}
                y1={gy}
                x2={width - CHART_PADDING.right}
                y2={gy}
                stroke="#E5E5E5"
                strokeWidth={0.5}
              />
              <SvgText
                x={CHART_PADDING.left - 6}
                y={gy + 3}
                style={{ fontSize: 7, color: "#999" }}
              >
                {val.toFixed(1)}
              </SvgText>
            </G>
          </React.Fragment>
        );
      })}

      <Line
        x1={CHART_PADDING.left}
        y1={baselineY}
        x2={width - CHART_PADDING.right}
        y2={baselineY}
        stroke="#16A34A"
        strokeWidth={1}
        strokeDasharray="4,3"
      />
      <SvgText
        x={width - CHART_PADDING.right + 2}
        y={baselineY + 3}
        style={{ fontSize: 6, color: "#16A34A" }}
      >
        0%
      </SvgText>

      {mainPoints.length > 1 && (
        <Polyline
          points={toPolyline(mainPoints)}
          fill="none"
          stroke="#DC2626"
          strokeWidth={1.5}
        />
      )}
      {mainPoints.map((p) => (
        <React.Fragment key={`pt-${p.i}`}>
          <Circle
            cx={xScale(p.i)}
            cy={yScale(p.v)}
            r={2}
            fill={p.v >= 0 ? "#16A34A" : "#DC2626"}
          />
        </React.Fragment>
      ))}

      {projPoints.length > 1 && (
        <Polyline
          points={toPolyline(projPoints)}
          fill="none"
          stroke="#DC2626"
          strokeWidth={1}
          strokeDasharray="4,3"
        />
      )}

      {initiatives.map((m) => {
        const ix = xScale(m.index);
        return (
          <React.Fragment key={`init-${m.index}`}>
            <G>
              <Line
                x1={ix}
                y1={CHART_PADDING.top}
                x2={ix}
                y2={height - CHART_PADDING.bottom}
                stroke="#2563EB"
                strokeWidth={0.5}
                strokeDasharray="2,2"
              />
              <Circle cx={ix} cy={CHART_PADDING.top + 4} r={3} fill="#2563EB" />
            </G>
          </React.Fragment>
        );
      })}

      {data.length > 0 && (
        <>
          <SvgText
            x={CHART_PADDING.left}
            y={height - 6}
            style={{ fontSize: 6, color: "#999" }}
          >
            {data[0]!.label}
          </SvgText>
          <SvgText
            x={width - CHART_PADDING.right}
            y={height - 6}
            style={{ fontSize: 6, color: "#999" }}
          >
            {data[data.length - 1]!.label}
          </SvgText>
        </>
      )}
    </Svg>
  );
}
