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
    fields: 'assembly_accession,scientific_name,last_updated',
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
    const status = document.getElementById('publications-chart-status');
    chartData.publications = [];
    renderChart('publications');
    status.textContent = 'Loading all PubMed-indexed Delftia articles…';
    try {
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
      status.textContent = total
        ? `${total.toLocaleString()} PubMed articles. ${undated ? `${undated} without a valid publication year omitted from graph. ` : ''}Retrieved ${new Date().toLocaleString()}.`
        : 'No PubMed articles found.';
    } catch {
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
        return data.filter(record => record.assembly_accession);
      },
      render(list, record) {
        addRecord(list, `${record.assembly_name || record.assembly_accession} — ${record.scientific_name || 'Delftia'}`,
          `https://www.ebi.ac.uk/ena/browser/view/${encodeURIComponent(record.assembly_accession)}`,
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
    const status = document.getElementById(`${feed.name}-status`);
    const list = document.getElementById(`${feed.name}-list`);
    status.textContent = `Loading latest ${feed.name}…`;
    list.replaceChildren();
    try {
      const data = await fetchRecords(feed.url);
      const records = feed.records(data);
      let count = records.length;
      if (feed.name === 'genomes') {
        genomeRecords = records;
        renderGenomeChart(records);
        count = renderGenomeList();
      } else {
        records.forEach(record => feed.render(list, record));
      }
      status.textContent = count
        ? `Showing ${count} records. Retrieved ${new Date().toLocaleString()}.`
        : `No ${feed.name} records found. Try the source link above.`;
    } catch {
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
    genomeRecords = [];
    chartData.genomes = [];
    renderChart('genomes');
    document.getElementById('genomes-chart-status').textContent = 'Loading all Delftia genome assemblies…';
    await Promise.all([...feeds.map(loadFeed), loadPublicationChart()]);
    updated.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    refresh.disabled = false;
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
  loadDashboard();
})();
