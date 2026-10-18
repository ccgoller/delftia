(() => {
  const first = document.getElementById('genome-first');
  const second = document.getElementById('genome-second');
  const controls = document.getElementById('genome-selection-controls');
  const status = document.getElementById('genome-selection-status');
  const retry = document.getElementById('genome-selection-retry');
  const comparison = document.getElementById('selected-genome-comparison');
  const selectors = [first, second].map(select => ({
    select,
    filter: document.getElementById(`${select.id}-filter`),
    count: document.getElementById(`${select.id}-count`),
  }));
  let genomes = new Map();
  let sorted = [];

  function text(value) {
    return typeof value === 'string' && value.trim() ? value : 'Not reported';
  }

  function number(value, suffix = '') {
    return (typeof value === 'number' || typeof value === 'string' && value.trim()) &&
      Number.isFinite(Number(value)) && Number(value) >= 0
      ? `${Number(value).toLocaleString('en-US')}${suffix}` : 'Not reported';
  }

  function label(genome) {
    const strain = genome.organism?.infraspecific_names?.strain;
    return `${text(genome.organism?.organism_name)}${strain ? ` — strain ${strain}` : ''} — ${text(genome.assembly_info?.assembly_name)} (${genome.accession})`;
  }

  function filterOptions({ select, filter, count }) {
    const selected = select.value;
    const terms = filter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = sorted.filter(genome => {
      const searchable = `${label(genome)} ${text(genome.assembly_info?.assembly_level)}`.toLocaleLowerCase();
      return terms.every(term => searchable.includes(term));
    });
    const retained = genomes.has(selected) && !matches.some(genome => genome.accession === selected);
    select.replaceChildren();
    for (const genome of retained ? [genomes.get(selected), ...matches] : matches) {
      const option = document.createElement('option');
      option.value = genome.accession;
      option.textContent = `${label(genome)}${retained && genome.accession === selected ? ' — selected; outside filter' : ''}`;
      select.append(option);
    }
    if (genomes.has(selected)) select.value = selected;
    count.textContent = `${matches.length.toLocaleString()} of ${genomes.size.toLocaleString()} assemblies match.${retained ? ' Selected genome kept outside filter.' : ''}`;
    renderComparison();
  }

  const features = [
    ['Species / organism', genome => text(genome.organism?.organism_name)],
    ['Strain', genome => text(genome.organism?.infraspecific_names?.strain)],
    ['Assembly name', genome => text(genome.assembly_info?.assembly_name)],
    ['Assembly level', genome => text(genome.assembly_info?.assembly_level)],
    ['Genome length', genome => number(genome.assembly_stats?.total_sequence_length, ' bp')],
    ['G+C content', genome => number(genome.assembly_stats?.gc_percent, '%')],
    ['Contigs', genome => number(genome.assembly_stats?.number_of_contigs)],
    ['Contig N50', genome => number(genome.assembly_stats?.contig_n50, ' bp')],
    ['Scaffolds', genome => number(genome.assembly_stats?.number_of_scaffolds)],
    ['Assembly release date', genome => text(genome.assembly_info?.release_date)],
  ];

  function renderComparison() {
    for (const option of first.options) option.disabled = option.value === second.value;
    for (const option of second.options) option.disabled = option.value === first.value;
    comparison.replaceChildren();
    comparison.hidden = true;
    if (!genomes.has(first.value) || !genomes.has(second.value) || first.value === second.value) {
      status.textContent = 'Choose two different genome assemblies to compare.';
      return;
    }

    const selected = [genomes.get(first.value), genomes.get(second.value)];
    const table = document.createElement('table');
    const caption = table.createCaption();
    caption.textContent = 'Reported assembly features from NCBI Datasets';
    const header = table.createTHead().insertRow();
    for (const name of ['Feature', ...selected.map(label)]) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = name;
      header.append(cell);
    }
    const body = table.createTBody();
    for (const [name, value] of features) {
      const row = body.insertRow();
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = name;
      row.append(heading);
      for (const genome of selected) row.insertCell().textContent = value(genome);
    }
    const sources = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = 'Assembly accession / source';
    sources.append(heading);
    for (const genome of selected) {
      const link = document.createElement('a');
      link.href = `https://www.ncbi.nlm.nih.gov/datasets/genome/${encodeURIComponent(genome.accession)}/`;
      link.textContent = genome.accession;
      sources.insertCell().append(link);
    }
    comparison.append(table);
    comparison.hidden = false;
    status.textContent = `Comparing ${label(selected[0])} with ${label(selected[1])}. ${genomes.size.toLocaleString()} assemblies available.`;
  }

  async function loadGenomes() {
    controls.hidden = false;
    first.disabled = true;
    second.disabled = true;
    for (const { filter, count } of selectors) {
      filter.disabled = true;
      count.textContent = '';
    }
    retry.hidden = true;
    comparison.hidden = true;
    status.textContent = 'Loading Delftia genome assemblies from NCBI Datasets…';
    genomes = new Map();
    sorted = [];
    first.replaceChildren();
    second.replaceChildren();
    try {
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
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('Unable to load assemblies');
        const data = await response.json();
        total ??= Number(data.total_count);
        const reports = data.reports ?? (total === 0 ? [] : null);
        if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(reports) ||
            (data.total_count !== undefined && Number(data.total_count) !== total)) {
          throw new Error('Invalid assembly response');
        }
        loaded += reports.length;
        for (const genome of reports) {
          if (typeof genome?.accession === 'string' && /^GCA_\d+\.\d+$/.test(genome.accession)) {
            genomes.set(genome.accession, genome);
          }
        }
        token = data.next_page_token || '';
        if (token && (typeof token !== 'string' || !reports.length || seen.has(token))) {
          throw new Error('Incomplete assembly response');
        }
        seen.add(token);
      } while (token);
      if (loaded !== total) throw new Error('Incomplete assembly response');
      if (genomes.size < 2) {
        status.textContent = 'Fewer than two genome assemblies are available. Use the published example below or retry.';
        retry.hidden = false;
        return;
      }
      sorted = [...genomes.values()].sort((a, b) => label(a).localeCompare(label(b)));
      for (const select of [first, second]) {
        for (const genome of sorted) {
          const option = document.createElement('option');
          option.value = genome.accession;
          option.textContent = label(genome);
          select.append(option);
        }
        select.disabled = false;
      }
      second.selectedIndex = 1;
      for (const selector of selectors) {
        selector.filter.disabled = false;
        filterOptions(selector);
      }
    } catch {
      status.textContent = 'Unable to load genome assemblies right now. Retry, browse NCBI Datasets, or use the published example below.';
      retry.hidden = false;
    }
  }

  for (const selector of selectors) {
    selector.filter.addEventListener('input', () => filterOptions(selector));
    selector.select.addEventListener('change', () => filterOptions(selector));
  }
  retry.addEventListener('click', loadGenomes);
  loadGenomes();
})();
