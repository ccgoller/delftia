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
        return data.filter(record => record.assembly_accession)
          .sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || '') ||
            a.assembly_accession.localeCompare(b.assembly_accession))
          .slice(0, 10);
      },
      render(list, record) {
        addRecord(list, `${record.assembly_accession} — ${record.scientific_name || 'Delftia'}`,
          `https://www.ebi.ac.uk/ena/browser/view/${encodeURIComponent(record.assembly_accession)}`,
          `Record updated: ${record.last_updated || 'Date unavailable'}`);
      },
    },
  ];

  async function loadFeed(feed) {
    const status = document.getElementById(`${feed.name}-status`);
    const list = document.getElementById(`${feed.name}-list`);
    status.textContent = `Loading latest ${feed.name}…`;
    list.replaceChildren();
    try {
      const records = feed.records(await fetchRecords(feed.url));
      records.forEach(record => feed.render(list, record));
      status.textContent = records.length
        ? `Showing ${records.length} records. Retrieved ${new Date().toLocaleString()}.`
        : `No ${feed.name} records found. Try the source link above.`;
    } catch {
      list.replaceChildren();
      status.textContent = `Unable to load ${feed.name} right now. Use the source link above or refresh to try again.`;
    }
  }

  const refresh = document.getElementById('refresh-dashboard');
  async function loadDashboard() {
    refresh.disabled = true;
    await Promise.all(feeds.map(loadFeed));
    refresh.disabled = false;
  }
  refresh.hidden = false;
  refresh.addEventListener('click', loadDashboard);
  loadDashboard();
})();
