/* ==========================================================================
   COACHBOOT ENTERPRISE — CHART HELPERS
   Thin wrappers around Chart.js / ApexCharts so every page renders charts
   with one consistent line of code, and colors follow the design tokens.
   ========================================================================== */

const CB = {
  colors: {
    accent: '#2C8F5E', accent2: '#E0972E', info: '#3E63C7',
    danger: '#C6414B', violet: '#6E56CF', muted: '#8FA79A',
  },

  gridColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'rgba(255,255,255,.08)' : 'rgba(14,26,21,.08)';
  },
  textColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? '#8FA79A' : '#5B6B62';
  },

  /* ---- Chart.js: radar ---- */
  radar(canvasId, labels, datasets) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    return new Chart(ctx, {
      type: 'radar',
      data: { labels, datasets: datasets.map((d, i) => ({
        label: d.label, data: d.data,
        borderColor: d.color || [this.colors.accent, this.colors.info][i % 2],
        backgroundColor: (d.color || [this.colors.accent, this.colors.info][i % 2]) + '33',
        borderWidth: 2, pointRadius: 3,
      })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: this.textColor(), font: { family: 'Inter', size: 11 } } } },
        scales: { r: {
          angleLines: { color: this.gridColor() }, grid: { color: this.gridColor() },
          pointLabels: { color: this.textColor(), font: { size: 11 } },
          ticks: { display: false, backdropColor: 'transparent' },
        } },
      },
    });
  },

  /* ---- Chart.js: line ---- */
  line(canvasId, labels, datasets, opts = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    return new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: datasets.map((d, i) => ({
        label: d.label, data: d.data,
        borderColor: d.color || [this.colors.accent, this.colors.accent2, this.colors.info][i % 3],
        backgroundColor: (d.color || [this.colors.accent, this.colors.accent2, this.colors.info][i % 3]) + '22',
        tension: .35, fill: !!opts.fill, pointRadius: 2, borderWidth: 2.4,
      })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { color: this.textColor(), font: { size: 11 } } } },
        scales: {
          x: { grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
          y: { grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
        },
      },
    });
  },

  /* ---- Chart.js: bar ---- */
  bar(canvasId, labels, datasets, opts = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: datasets.map((d, i) => ({
        label: d.label, data: d.data,
        backgroundColor: d.color || [this.colors.accent, this.colors.accent2, this.colors.info][i % 3],
        borderRadius: 5, maxBarThickness: 26,
      })) },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, labels: { color: this.textColor(), font: { size: 11 } } } },
        scales: {
          x: { grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
          y: { grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
        },
      },
    });
  },

  /* ---- Chart.js: scatter (nuage de points) — points = [{x, y, label}] ---- */
  scatter(canvasId, points, opts = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [{
        label: opts.label || '',
        data: points.map(p => ({ x: p.x, y: p.y })),
        backgroundColor: opts.color || this.colors.accent,
        pointRadius: 6, pointHoverRadius: 8,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => {
            const p = points[item.dataIndex];
            return `${p.label}: ${opts.xLabel || 'x'}=${p.x}, ${opts.yLabel || 'y'}=${p.y}`;
          } } },
        },
        scales: {
          x: { title: { display: !!opts.xLabel, text: opts.xLabel, color: this.textColor() }, grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
          y: { title: { display: !!opts.yLabel, text: opts.yLabel, color: this.textColor() }, grid: { color: this.gridColor() }, ticks: { color: this.textColor(), font: { size: 10.5 } } },
        },
      },
    });
  },

  /* ---- Chart.js: doughnut ---- */
  doughnut(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;
    return new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors || [this.colors.accent, this.colors.accent2, this.colors.info, this.colors.violet, this.colors.danger], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: { legend: { position: 'bottom', labels: { color: this.textColor(), font: { size: 11 }, boxWidth: 10, padding: 14 } } },
      },
    });
  },

  /* ---- ApexCharts: area (season performance) ---- */
  apexArea(elId, categories, series, opts = {}) {
    if (!window.ApexCharts) return;
    const chart = new ApexCharts(document.querySelector(elId), {
      chart: { type: 'area', height: opts.height || 260, toolbar: { show: false }, fontFamily: 'Inter' },
      series, colors: opts.colors || [this.colors.accent, this.colors.info],
      xaxis: { categories, labels: { style: { colors: this.textColor(), fontSize: '10.5px' } }, axisBorder: { show: false } },
      yaxis: { labels: { style: { colors: this.textColor(), fontSize: '10.5px' } } },
      grid: { borderColor: this.gridColor(), strokeDashArray: 4 },
      stroke: { curve: 'smooth', width: 2.4 },
      fill: { type: 'gradient', gradient: { opacityFrom: .35, opacityTo: 0 } },
      dataLabels: { enabled: false },
      legend: { labels: { colors: this.textColor() } },
      tooltip: { theme: document.documentElement.getAttribute('data-theme') },
    });
    chart.render();
    return chart;
  },

  /* ---- ApexCharts: radial (xG-like single gauge) ---- */
  apexRadial(elId, label, value, color) {
    if (!window.ApexCharts) return;
    const chart = new ApexCharts(document.querySelector(elId), {
      chart: { type: 'radialBar', height: 220, fontFamily: 'Inter' },
      series: [value], labels: [label], colors: [color || this.colors.accent],
      plotOptions: { radialBar: { hollow: { size: '62%' }, dataLabels: {
        value: { fontSize: '22px', fontWeight: 700, color: this.textColor() === '#8FA79A' ? '#E9F2EC' : '#0E1A15' },
        name: { fontSize: '11px', color: this.textColor() },
      } } },
    });
    chart.render();
    return chart;
  },

  /* ---- Custom CSS heatmap grid (pitch zones) ---- */
  heatmap(containerId, matrix) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const cols = matrix[0].length;
    el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.innerHTML = matrix.flat().map(v => {
      const alpha = Math.max(.08, v / 100);
      return `<div class="cell" style="background:rgba(44,143,94,${alpha})" title="${v}%"></div>`;
    }).join('');
  },
};
