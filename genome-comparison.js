(() => {
  const selectors = document.getElementById('genome-selectors');
  const first = document.getElementById('genome-first');
  const second = document.getElementById('genome-second');
  const status = document.getElementById('genome-selection-status');
  const retry = document.getElementById('genome-selection-retry');
  const comparison = document.getElementById('selected-genome-comparison');
  let genomes = new Map();

  const text = value => typeof value === 'string' && value.trim() ? value : 'Not reported';
  const number = (value, suffix = '') =>
    value !== null && value !== undefined && value !== '' &&
    Number.isFinite(Number(value)) && Number(value) >= 0
      ? `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })}${suffix}`
      : 'Not reported';
  const label = report => `${text(report.organism?.organism_name)} — ${report.accession}${report.assembly_info?.assembly_name ? ` (${report.assembly_info.assembly_name})` : ''}`;
  const features = [
    ['Organism', report => text(report.organism?.organism_name)],
    ['Strain', report => text(report.organism?.infraspecific_names?.strain)],
    ['Assembly name', report => text(report.assembly_info?.assembly_name)],
    ['Assembly level', report => text(report.assembly_info?.assembly_level)],
    ['Genome length', report => number(report.assembly_stats?.total_sequence_length, ' bp')],
    ['G+C content', report => number(report.assembly_stats?.gc_percent, '%')],
    ['Contigs', report => number(report.assembly_stats?.number_of_contigs)],
    ['Contig N50', report => number(report.assembly_stats?.contig_n50, ' bp')],
    ['Assembly release date', report => text(report.assembly_info?.release_date)],
  ];

  function renderComparison() {
    comparison.replaceChildren();
    comparison.hidden = true;
    if (!first.value || !second.value) {
      status.textContent = 'Choose two different genomes to compare.';
      return;
    }
    if (first.value === second.value) {
      status.textContent = 'Choose two different genomes; the same assembly is selected twice.';
      return;
    }
    const reports = [genomes.get(first.value), genomes.get(second.value)];
    const table = document.createElement('table');
    const caption = table.createCaption();
    caption.textContent = 'Reported assembly features from NCBI Datasets';
    const header = table.createTHead().insertRow();
    for (const heading of ['Feature', ...reports.map(report => report.accession)]) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      header.append(cell);
    }
    const body = table.createTBody();
    for (const [name, value] of features) {
      const row = body.insertRow();
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = name;
      row.append(heading);
      for (const report of reports) row.insertCell().textContent = value(report);
    }
    const sourceRow = body.insertRow();
    const sourceHeading = document.createElement('th');
    sourceHeading.scope = 'row';
    sourceHeading.textContent = 'Source';
    sourceRow.append(sourceHeading);
    for (const report of reports) {
      const link = document.createElement('a');
      link.href = `https://www.ncbi.nlm.nih.gov/datasets/genome/${report.accession}/`;
      link.textContent = `View ${report.accession} on NCBI`;
      sourceRow.insertCell().append(link);
    }
    comparison.append(table);
    comparison.hidden = false;
    status.textContent = `Comparing ${first.value} with ${second.value}. ${genomes.size.toLocaleString()} assemblies available.`;
  }

  async function loadGenomes() {
    selectors.hidden = true;
    comparison.hidden = true;
    retry.hidden = true;
    status.textContent = 'Loading Delftia genome assemblies from NCBI…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const records = new Map();
      const seenTokens = new Set();
      let token = '';
      do {
        const url = new URL('https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/80865/dataset_report');
        url.search = new URLSearchParams({
          'filters.assembly_source': 'genbank',
          page_size: '1000',
          ...(token ? { page_token: token } : {}),
        });
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load assemblies');
        const data = await response.json();
        const reports = data.reports ?? (Number(data.total_count) === 0 ? [] : null);
        if (!Array.isArray(reports)) throw new Error('Invalid assembly response');
        for (const report of reports) {
          if (/^GCA_\d+\.\d+$/.test(report?.accession)) records.set(report.accession, report);
        }
        token = data.next_page_token || '';
        if (token && (!reports.length || seenTokens.has(token))) throw new Error('Invalid pagination');
        seenTokens.add(token);
      } while (token);
      genomes = records;
      const sorted = [...records.values()].sort((a, b) => label(a).localeCompare(label(b)));
      for (const select of [first, second]) {
        select.replaceChildren(new Option('Choose a genome', ''));
        for (const report of sorted) select.add(new Option(label(report), report.accession));
      }
      if (records.size < 2) {
        status.textContent = 'Fewer than two genome assemblies are available. Use the published example below or retry.';
        retry.hidden = false;
        return;
      }
      selectors.hidden = false;
      status.textContent = `${records.size.toLocaleString()} assemblies loaded. Choose two different genomes to compare.`;
    } catch {
      status.textContent = 'Unable to load genome assemblies from NCBI. Retry or use the published example below.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
    }
  }

  first.addEventListener('change', renderComparison);
  second.addEventListener('change', renderComparison);
  retry.addEventListener('click', loadGenomes);
  loadGenomes();
})();
