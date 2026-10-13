(() => {
  const publicationsURL = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  publicationsURL.search = new URLSearchParams({
    query: 'Delftia sort_date:y',
    format: 'json',
    pageSize: '10',
  });
  const genomesURL = new URL('https://www.ebi.ac.uk/ena/portal/api/search');
  genomesURL.search = new URLSearchParams({
    result: 'assembly',
    query: 'tax_tree(80865)',
    fields: 'accession,assembly_name,scientific_name,version,last_updated',
    format: 'json',
    limit: '0',
  });

  async function fetchRecords(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Database request failed');
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function addRecord(list, title, url, detail) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = title;
    link.href = url;
    const description = document.createElement('p');
    description.textContent = detail;
    item.append(link, description);
    list.append(item);
  }

  const chartData = {};
  const growthData = { publications: null, genomes: null, undatedGenomes: 0 };
  const growthChart = document.getElementById('growth-chart');
  const growthYear = document.getElementById('growth-chart-year');
  const growthDetail = document.getElementById('growth-chart-detail');
  let growthRows = [];

  function svgElement(name, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function inspectGrowthYear(index) {
    const row = growthRows[index];
    if (!row) return;
    growthYear.value = index;
    growthYear.setAttribute('aria-valuetext', String(row.year));
    growthDetail.textContent = `${row.year}: ${row.publications.toLocaleString()} publications, ${row.cumulativePublications.toLocaleString()} cumulative publications, ${row.genomes.toLocaleString()} genomes, ${row.cumulativeGenomes.toLocaleString()} cumulative genomes.`;
    const marker = growthChart.querySelector('.growth-marker');
    const x = growthRows.length === 1 ? 384 : 64 + index / (growthRows.length - 1) * 640;
    if (marker) {
      marker.setAttribute('x1', x);
      marker.setAttribute('x2', x);
    }
  }

  function renderGrowthChart() {
    const status = document.getElementById('growth-chart-status');
    const controls = document.getElementById('growth-chart-controls');
    growthChart.replaceChildren();
    growthDetail.textContent = '';
    controls.hidden = true;
    if (!growthData.publications || !growthData.genomes) {
      status.textContent = 'Unable to load the annual graph right now. PubMed counts, ENA assemblies, and NCBI release dates are required; refresh to try again.';
      return;
    }
    const years = [...growthData.publications.keys(), ...growthData.genomes.keys()].map(Number);
    if (!years.length) {
      status.textContent = 'No dated records available for the annual graph.';
      return;
    }
    const selectedYear = growthRows[Number(growthYear.value)]?.year;
    growthRows = [];
    let cumulativeGenomes = 0;
    let cumulativePublications = 0;
    for (let year = Math.min(...years); year <= new Date().getFullYear(); year++) {
      const genomes = growthData.genomes.get(String(year)) || 0;
      const publications = growthData.publications.get(String(year)) || 0;
      cumulativeGenomes += genomes;
      cumulativePublications += publications;
      growthRows.push({
        year,
        genomes,
        cumulativeGenomes,
        'cumulative-genomes': cumulativeGenomes,
        cumulative: cumulativeGenomes,
        publications,
        cumulativePublications,
        'cumulative-publications': cumulativePublications,
      });
    }
    const series = [...document.querySelectorAll('[data-growth-series]:checked')].map(input => input.dataset.growthSeries);
    const maximum = Math.max(1, ...growthRows.flatMap(row => series.map(name => row[name] ?? 0)));
    const x = index => growthRows.length === 1 ? 384 : 64 + index / (growthRows.length - 1) * 640;
    const y = count => 264 - count / maximum * 232;
    for (let tick = 0; tick <= 4; tick++) {
      const count = maximum * tick / 4;
      growthChart.append(
        svgElement('line', { x1: 64, x2: 704, y1: y(count), y2: y(count), class: 'growth-grid' }),
        svgElement('text', { x: 56, y: y(count) + 5, 'text-anchor': 'end' }, count.toLocaleString(undefined, { maximumFractionDigits: 1 })),
      );
    }
    growthChart.append(svgElement('text', { x: 64, y: 20 }, 'Count'));
    const interval = Math.max(1, Math.ceil((growthRows.length - 1) / 6));
    growthRows.forEach((row, index) => {
      if (index % interval === 0 || index === growthRows.length - 1) {
        growthChart.append(svgElement('text', { x: x(index), y: 290, 'text-anchor': 'middle' }, row.year));
      }
    });
    growthChart.append(svgElement('text', { x: 384, y: 312, 'text-anchor': 'middle' }, 'Year'));
    for (const name of series) {
      const extraClass = (name === 'cumulative-genomes' || name === 'cumulative') ? ' growth-cumulative' : '';
      const group = svgElement('g', { class: `growth-series growth-${name}${extraClass}`, 'data-series': name });
      group.append(svgElement('polyline', { points: growthRows.map((row, index) => `${x(index)},${y(row[name] ?? 0)}`).join(' '), fill: 'none' }));
      growthRows.forEach((row, index) => {
        group.append(svgElement('circle', { cx: x(index), cy: y(row[name] ?? 0), r: 3 }));
      });
      growthChart.append(group);
    }
    growthChart.append(svgElement('line', { x1: 64, x2: 64, y1: 32, y2: 264, class: 'growth-marker' }));
    growthRows.forEach((row, index) => {
      const left = index === 0 ? 64 : (x(index - 1) + x(index)) / 2;
      const right = index === growthRows.length - 1 ? 704 : (x(index) + x(index + 1)) / 2;
      const target = svgElement('rect', { x: left, y: 32, width: right - left, height: 232, fill: 'transparent' });
      target.append(svgElement('title', {}, `${row.year}: ${row.publications} publications, ${row.cumulativePublications} cumulative publications, ${row.genomes} genomes, ${row.cumulativeGenomes} cumulative genomes`));
      target.addEventListener('pointerenter', () => inspectGrowthYear(index));
      target.addEventListener('pointerdown', () => inspectGrowthYear(index));
      growthChart.append(target);
    });
    growthYear.max = growthRows.length - 1;
    controls.hidden = false;
    status.textContent = `All matching PubMed articles and ENA assemblies with valid years. Genome years use NCBI assembly release dates. ${growthData.undatedGenomes} assemblies without a valid release date excluded. Retrieved ${new Date().toLocaleString()}.`;
    const index = growthRows.findIndex(row => row.year === selectedYear);
    inspectGrowthYear(index < 0 ? growthRows.length - 1 : index);
  }

  function countGenomeYears(records) {
    const years = new Map();
    for (const record of records) {
      const date = record.release_date;
      const parsed = new Date(date);
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          date >= '1800-01-01' && date <= new Date().toISOString().slice(0, 10) &&
          Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) {
        const year = date.slice(0, 4);
        years.set(year, (years.get(year) || 0) + 1);
      } else {
        growthData.undatedGenomes++;
      }
    }
    growthData.genomes = years;
  }

  async function loadGenomeYears(records) {
    const dates = new Map();
    if (records.length) {
      let token = '';
      let total;
      let loaded = 0;
      const seen = new Set();
      do {
        const url = new URL('https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/80865/dataset_report');
        url.search = new URLSearchParams({
          'filters.assembly_source': 'genbank',
          page_size: '1000',
          ...(token ? { page_token: token } : {}),
        });
        const data = await fetchRecords(url);
        total ??= Number(data.total_count);
        if (!Number.isSafeInteger(total) || total < 0 ||
            (data.total_count !== undefined && Number(data.total_count) !== total)) {
          throw new Error('Invalid assembly release dates count');
        }
        const reports = data.reports ?? (Number(data.total_count) === 0 ? [] : null);
        if (!Array.isArray(reports)) throw new Error('Invalid assembly release dates response');
        loaded += reports.length;
        for (const report of reports) {
          if (typeof report.accession === 'string' && report.accession.startsWith('GCA_')) {
            dates.set(report.accession, report.assembly_info?.release_date);
          }
        }
        token = data.next_page_token || '';
        if (token && (!reports.length || seen.has(token))) {
          throw new Error('Incomplete assembly release dates response');
        }
        seen.add(token);
      } while (token);
      if (loaded !== total) throw new Error('Incomplete assembly release dates response');
    }
    countGenomeYears(records.map(record => ({
      release_date: dates.get(record.assembly_accession.includes('.') || !record.version
        ? record.assembly_accession : `${record.assembly_accession}.${record.version}`),
    })));
  }

  function compareDates(a, b, order) {
    const first = /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : '';
    const second = /^\d{4}-\d{2}-\d{2}$/.test(b) ? b : '';
    if (!first || !second) return Number(Boolean(second)) - Number(Boolean(first));
    return order === 'oldest' ? first.localeCompare(second) : second.localeCompare(first);
  }

  function renderChart(name) {
    const chart = document.getElementById(`${name}-chart`);
    const detail = document.getElementById(`${name}-chart-detail`);
    const order = document.getElementById(`${name}-chart-sort`).value;
    const rows = [...(chartData[name] || [])];
    rows.sort(name === 'publications'
      ? (a, b) => order === 'ascending' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label)
      : (a, b) => (order === 'newest' || order === 'oldest'
        ? compareDates(a.updated, b.updated, order)
        : order === 'ascending' ? 0 : b.count - a.count) || a.label.localeCompare(b.label));
    const maximum = Math.max(1, ...rows.map(row => row.count));
    chart.replaceChildren();
    detail.textContent = '';
    for (const row of rows) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const description = `${row.label}: ${row.count.toLocaleString()} ${name === 'publications' ? 'PubMed articles' : 'genome assemblies'}`;
      link.href = row.url;
      link.className = 'dashboard-chart-row';
      link.setAttribute('aria-label', `${description}. Browse source records.`);
      link.title = description;
      const label = document.createElement('span');
      label.textContent = row.label;
      const track = document.createElement('span');
      track.className = 'dashboard-chart-track';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = 'dashboard-chart-bar';
      bar.style.width = `${row.count / maximum * 100}%`;
      track.append(bar);
      const count = document.createElement('span');
      count.className = 'dashboard-chart-count';
      count.textContent = row.count.toLocaleString();
      link.append(label, track, count);
      for (const event of ['mouseenter', 'focus']) {
        link.addEventListener(event, () => { detail.textContent = description; });
      }
      item.append(link);
      chart.append(item);
    }
  }

  function renderGenomeChart(records) {
    const groups = new Map();
    const accessions = new Set();
    for (const record of records) {
      if (!record.assembly_accession || accessions.has(record.assembly_accession)) continue;
      accessions.add(record.assembly_accession);
      const species = record.scientific_name || 'Scientific name unavailable';
      const group = groups.get(species) || { count: 0, updated: '' };
      group.count++;
      if (/^\d{4}-\d{2}-\d{2}$/.test(record.last_updated) && record.last_updated > group.updated) {
        group.updated = record.last_updated;
      }
      groups.set(species, group);
    }
    chartData.genomes = [...groups].map(([label, { count, updated }]) => {
      const url = new URL('https://www.ebi.ac.uk/ena/browser/advanced-search');
      url.search = new URLSearchParams({
        result: 'assembly',
        query: label === 'Scientific name unavailable' ? 'tax_tree(80865)'
          : `tax_tree(80865) AND scientific_name="${label.replace(/["\\]/g, '\\$&')}"`,
      });
      return { label, count, updated, url: url.href };
    });
    renderChart('genomes');
    document.getElementById('genomes-chart-status').textContent = accessions.size
      ? `${accessions.size.toLocaleString()} assembly records across ${groups.size} scientific names. Retrieved ${new Date().toLocaleString()}.`
      : 'No genome assembly records found.';
  }

  async function loadPublicationChart() {
    try {
      const status = document.getElementById('publications-chart-status');
      chartData.publications = [];
      renderChart('publications');
      status.textContent = 'Loading all PubMed-indexed Delftia articles…';
      const years = new Map();
      let cursor = '*';
      let loaded = 0;
      let undated = 0;
      let total;
      const seen = new Set();
      do {
        const url = new URL(publicationsURL);
        url.search = new URLSearchParams({
          query: 'Delftia AND SRC:MED', format: 'json', pageSize: '1000', cursorMark: cursor,
        });
        const data = await fetchRecords(url);
        const records = data.resultList?.result;
        if (!Array.isArray(records) || !Number.isInteger(data.hitCount) || data.hitCount < 0) {
          throw new Error('Invalid article counts response');
        }
        total ??= data.hitCount;
        if (total !== data.hitCount) throw new Error('Article count changed during retrieval');
        loaded += records.length;
        for (const record of records) {
          const year = String(record.pubYear || '');
          if (/^\d{4}$/.test(year) && Number(year) >= 1800 && Number(year) <= new Date().getFullYear()) {
            years.set(year, (years.get(year) || 0) + 1);
          } else {
            undated++;
          }
        }
        if (loaded >= total) break;
        if (!records.length || !data.nextCursorMark || seen.has(data.nextCursorMark)) {
          throw new Error('Incomplete article counts response');
        }
        seen.add(cursor);
        cursor = data.nextCursorMark;
      } while (true);
      if (years.size) {
        const first = Math.min(...[...years.keys()].map(Number));
        for (let year = first; year <= new Date().getFullYear(); year++) {
          const url = new URL('https://pubmed.ncbi.nlm.nih.gov/');
          url.searchParams.set('term', `Delftia AND ${year}[dp]`);
          chartData.publications.push({ label: String(year), count: years.get(String(year)) || 0, url: url.href });
        }
      }
      renderChart('publications');
      growthData.publications = years;
      status.textContent = total
        ? `${total.toLocaleString()} PubMed articles. ${undated ? `${undated} without a valid publication year omitted from graph. ` : ''}Retrieved ${new Date().toLocaleString()}.`
        : 'No PubMed articles found.';
    } catch {
      const status = document.getElementById('publications-chart-status');
      status.textContent = 'Unable to load PubMed article counts right now. Use the PubMed link above or refresh to try again.';
    }
  }

  const feeds = [
    {
      name: 'publications',
      url: publicationsURL,
      records(data) {
        if (!Array.isArray(data.resultList?.result)) throw new Error('Invalid publications response');
        return data.resultList.result.slice(0, 10);
      },
      render(list, record) {
        const url = record.doi
          ? `https://doi.org/${encodeURIComponent(record.doi)}`
          : `https://europepmc.org/article/${encodeURIComponent(record.source)}/${encodeURIComponent(record.id)}`;
        addRecord(list, record.title || 'Untitled publication', url,
          [record.authorString, record.journalTitle,
            `Published: ${record.firstPublicationDate || record.pubYear || 'Date unavailable'}`]
            .filter(Boolean).join(' · '));
      },
    },
    {
      name: 'genomes',
      url: genomesURL,
      records(data) {
        if (!Array.isArray(data)) throw new Error('Invalid genomes response');
        const accessions = new Set();
        return data.map(record => ({
          assembly_accession: record.assembly_accession || record.accession,
          assembly_name: record.assembly_name || record.assembly_accession || record.accession,
          scientific_name: record.scientific_name,
          last_updated: record.last_updated || 'Date unavailable',
          version: record.version,
        })).filter(record => {
          if (!record.assembly_accession || accessions.has(record.assembly_accession)) return false;
          accessions.add(record.assembly_accession);
          return true;
        });
      },
      render(list, record) {
        addRecord(list, `${record.assembly_name || record.assembly_accession} — ${record.scientific_name || 'Delftia'}`,
          `https://www.ncbi.nlm.nih.gov/assembly/${encodeURIComponent(record.assembly_accession)}`,
          `${record.assembly_accession} · Record updated: ${record.last_updated || 'Date unavailable'}`);
      },
    },
  ];

  const search = document.getElementById('dashboard-search');
  const resultsStatus = document.getElementById('dashboard-results-status');
  const publicationCount = document.getElementById('publications-count');
  const genomeCount = document.getElementById('genomes-count');
  const updated = document.getElementById('dashboard-updated');
  const genomeSort = document.getElementById('genomes-sort');
  let genomeRecords = [];

  function renderGenomeList() {
    const list = document.getElementById('genomes-list');
    const feed = feeds.find(feed => feed.name === 'genomes');
    const order = genomeSort.value;
    const records = [...genomeRecords].sort((a, b) =>
      (order === 'name'
        ? (a.assembly_name || a.assembly_accession).localeCompare(b.assembly_name || b.assembly_accession)
        : compareDates(a.last_updated, b.last_updated, order)) ||
      a.assembly_accession.localeCompare(b.assembly_accession)).slice(0, 10);
    list.replaceChildren();
    records.forEach(record => feed.render(list, record));
    updateDashboardSummary();
    return records.length;
  }

  function updateDashboardSummary() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    let total = 0;

    for (const feed of feeds) {
      const list = document.getElementById(`${feed.name}-list`);
      const items = [...list.children];
      const visible = items.reduce((count, item) => {
        const isMatch = item.textContent.toLocaleLowerCase().includes(query);
        item.hidden = !isMatch;
        return count + Number(isMatch);
      }, 0);
      total += items.length;
      matches += visible;
      document.getElementById(`${feed.name}-count`).textContent = items.length;
    }

    resultsStatus.textContent = query
      ? (matches ? `Showing ${matches} of ${total} loaded records matching “${search.value.trim()}”.`
        : `No loaded records match “${search.value.trim()}”.`)
      : `Showing all ${total} loaded records.`;
  }

  async function loadFeed(feed) {
    try {
      const status = document.getElementById(`${feed.name}-status`);
      const list = document.getElementById(`${feed.name}-list`);
      status.textContent = `Loading latest ${feed.name}…`;
      list.replaceChildren();
      const data = await fetchRecords(feed.url);
      const records = feed.records(data);
      let count = records.length;
      if (feed.name === 'genomes') {
        genomeRecords = records;
        renderGenomeChart(records);
        count = renderGenomeList();
        try {
          await loadGenomeYears(records);
        } catch {
          growthData.genomes = null;
        }
      } else {
        records.forEach(record => feed.render(list, record));
      }
      status.textContent = count
        ? `Showing ${count} records. Retrieved ${new Date().toLocaleString()}.`
        : `No ${feed.name} records found. Try the source link above.`;
    } catch {
      const status = document.getElementById(`${feed.name}-status`);
      const list = document.getElementById(`${feed.name}-list`);
      list.replaceChildren();
      status.textContent = `Unable to load ${feed.name} right now. Use the source link above or refresh to try again.`;
      if (feed.name === 'genomes') {
        document.getElementById('genomes-chart-status').textContent = 'Unable to load genome counts right now. Use the ENA link below or refresh to try again.';
      }
    } finally {
      updateDashboardSummary();
    }
  }

  const refresh = document.getElementById('refresh-dashboard');
  async function loadDashboard() {
    refresh.disabled = true;
    updated.textContent = 'Checking…';
    growthData.publications = null;
    growthData.genomes = null;
    growthData.undatedGenomes = 0;
    growthRows = [];
    growthChart.replaceChildren();
    growthDetail.textContent = '';
    document.getElementById('growth-chart-controls').hidden = true;
    document.getElementById('growth-chart-status').textContent = 'Loading annual publication and genome counts…';
    genomeRecords = [];
    chartData.genomes = [];
    renderChart('genomes');
    document.getElementById('genomes-chart-status').textContent = 'Loading all Delftia genome assemblies…';
    try {
      await Promise.all([...feeds.map(loadFeed), loadPublicationChart()]);
    } finally {
      renderGrowthChart();
      updated.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      refresh.disabled = false;
    }
  }
  search.hidden = false;
  refresh.hidden = false;
  genomeSort.hidden = false;
  genomeSort.addEventListener('change', renderGenomeList);
  for (const name of ['publications', 'genomes']) {
    const sort = document.getElementById(`${name}-chart-sort`);
    sort.hidden = false;
    sort.addEventListener('change', () => renderChart(name));
  }
  search.addEventListener('input', updateDashboardSummary);
  refresh.addEventListener('click', loadDashboard);
  growthYear.addEventListener('input', () => inspectGrowthYear(Number(growthYear.value)));
  for (const input of document.querySelectorAll('[data-growth-series]')) {
    input.addEventListener('change', renderGrowthChart);
  }
  loadDashboard();
})();
