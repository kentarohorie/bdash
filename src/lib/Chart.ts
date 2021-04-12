import Plotly, { PlotlyHTMLElement } from "plotly.js-basic-dist-min";
import _ from "lodash";

type Params = {
  readonly type: "line" | "scatter" | "bar" | "area" | "pie";
  readonly stacking: 0 | string;
  readonly groupBy: string | null;
  readonly rows: (string | number)[][];
  readonly fields: string[];
  readonly x: string;
  readonly y: string[];
};

export default class Chart {
  private readonly params: Params;

  constructor(params: Params) {
    this.params = params;
  }

  drawTo(dom: HTMLElement): Promise<PlotlyHTMLElement> {
    return Plotly.newPlot(dom, this.getData(), this.getLayout(), {
      displayModeBar: false,
      responsive: true
    });
  }

  async toSVG(): Promise<string | null> {
    const data = this.getData();
    const layout = this.getLayout();
    const div = document.createElement("div");

    if (data.length === 0) {
      return Promise.resolve(null);
    }

    const gd = await Plotly.plot(div, data, layout);
    // max width of gist image in pc browser
    const width = 1100;
    // aspect ratio (450:700) is default of plotly.js
    // https://plot.ly/javascript/reference/#layout-width
    // https://plot.ly/javascript/reference/#layout-height
    const height = 300;
    return Plotly.toImage(gd, { format: "svg", width, height }).then(svg => {
      const dataURI = decodeURIComponent(svg);
      return dataURI.substr(dataURI.indexOf(",") + 1).replace(/"Open Sans"/g, "'Open Sans'");
    });
  }

  getData(): Partial<Plotly.PlotData>[] {
    return this[this.params.type]();
  }

  getLayout(): Partial<Plotly.Layout> {
    const layout: Partial<Plotly.Layout> = {
      showlegend: true,
      margin: { l: 50, r: 50, t: 10, b: 10, pad: 4 },
      hoverlabel: { namelength: -1 },
      xaxis: { automargin: true },
      yaxis: { automargin: true }
    };

    if (this.params.stacking === "enable") {
      layout.barmode = "stack";
    }
    if (this.params.stacking === "percent") {
      layout.barmode = "stack";
      layout.barnorm = "percent";
    }

    return layout;
  }

  // TODO: Performance tuning
  generateChartData(): { x: (string | number)[]; y: (string | number)[]; name: string }[] {
    if (!this.params.y) return [];

    if (!this.params.groupBy || !this.params.fields.includes(this.params.groupBy)) {
      return this.params.y.map(y => {
        return {
          x: this.dataByField(this.params.x),
          y: this.dataByField(y),
          name: y
        };
      });
    }

    // NOTE: Can delete sort?
    const groupValues = _.uniq(this.dataByField(this.params.groupBy)).sort();
    const idx = this.params.fields.findIndex(field => field === this.params.groupBy);
    const x = _.groupBy(this.params.rows, row => row[idx]);
    const groupByIdx = this.rowIndexByFieldName(this.params.groupBy);

    return _.flatMap(this.params.y, y => {
      const yIdx = this.rowIndexByFieldName(y);
      return groupValues.map(g => {
        return {
          name: `${y} (${g})`,
          x: this.valuesByField(x[g], this.params.x),
          y: this.params.rows.filter(row => row[groupByIdx] === g).map(row => row[yIdx])
        };
      });
    });
  }

  rowIndexByFieldName(field: string): number {
    return this.params.fields.findIndex(f => f === field);
  }

  valuesByField(rows: (string | number)[][], field: string): (string | number)[] {
    const idx = this.rowIndexByFieldName(field);
    return rows.map(row => row[idx]);
  }

  dataByField(field: string): (string | number)[] {
    return this.valuesByField(this.params.rows, field);
  }

  line(): Partial<Plotly.PlotData>[] {
    return this.generateChartData().map(data => ({
      type: "scatter",
      x: data.x,
      y: data.y,
      name: data.name,
      mode: "lines"
    }));
  }

  scatter(): Partial<Plotly.PlotData>[] {
    return this.generateChartData().map(data => ({
      type: "scatter",
      x: data.x,
      y: data.y,
      name: data.name,
      mode: "markers",
      marker: { size: 10 }
    }));
  }

  bar(): Partial<Plotly.PlotData>[] {
    return this.generateChartData().map(data => ({
      type: "bar",
      x: data.x,
      y: data.y,
      name: data.name
    }));
  }

  area(): Partial<Plotly.PlotData>[] {
    return this.generateChartData().map(data => ({
      type: "scatter",
      x: data.x,
      y: data.y,
      name: data.name,
      mode: "lines",
      fill: "tozeroy"
    }));
  }

  pie(): Partial<Plotly.PlotData>[] {
    return [
      {
        type: "pie",
        direction: "clockwise",
        labels: this.dataByField(this.params.x),
        values: this.dataByField(this.params.y[0])
      }
    ];
  }

  // x = pv, y = cv
  normal() {
    return this.generateChartData().map(data => {
      const pv_sum = data.x
        .filter((v): v is string => typeof v === "string")
        .map(v => parseInt(v))
        .reduce((sum, i) => sum + i);
      const cv_sum = data.y
        .filter((v): v is string => typeof v === "string")
        .map(v => parseInt(v))
        .reduce((sum, i) => sum + i);

      const m = cv_sum / pv_sum;
      const v = (m * (1 - m)) / pv_sum;
      const d = Math.sqrt(v);

      const xmin = Math.max(0, m - d * 5);
      const xmax = m + d * 5;
      const step = xmax / 5000;
      const n = Math.floor((xmax - xmin) / step);
      const pxscale = new Array(n);
      let i = 0;
      while (i <= n) {
        if (i === 0) {
          pxscale[i] = xmin;
        } else {
          pxscale[i] = pxscale[i - 1] + step;
        }
        i++;
      }

      const y = pxscale.map(px => {
        const ex = -((px - m) ** 2 / (2 * v));
        return (1 / Math.sqrt(2 * v * Math.PI)) * Math.E ** ex;
      });

      const strippedX: number[] = [];
      const strippedY: number[] = [];
      const threshold = 0.1;

      y.forEach((n, i) => {
        if (n >= threshold) {
          strippedX.push(pxscale[i]);
          strippedY.push(n);
        }
      });

      return {
        type: "scatter",
        x: strippedX,
        y: strippedY,
        name: data.name,
        slowlegend: true
      };
    });
  }
}
