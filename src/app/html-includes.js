function getIncludeTemplates(root) {
  return Array.from(root.querySelectorAll("template[data-html-include]"));
}

function resolveIncludeUrl(includePath, baseUrl = document.baseURI) {
  return new URL(includePath, baseUrl).href;
}

async function loadHtmlFragment(includeUrl) {
  const response = await fetch(includeUrl, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load HTML partial: ${includeUrl}`);
  }

  return response.text();
}

function createFragmentFromHtml(html, includeUrl) {
  const template = document.createElement("template");
  template.innerHTML = html;
  getIncludeTemplates(template.content).forEach((nestedTemplate) => {
    const nestedPath = nestedTemplate.dataset.htmlInclude;
    if (nestedPath) {
      nestedTemplate.dataset.htmlInclude = resolveIncludeUrl(nestedPath, includeUrl);
    }
  });
  return template.content.cloneNode(true);
}

export async function hydrateHtmlIncludes(root = document) {
  while (true) {
    const includeTemplates = getIncludeTemplates(root);
    if (includeTemplates.length === 0) return;

    await Promise.all(
      includeTemplates.map(async (template) => {
        const includePath = template.dataset.htmlInclude;
        if (!includePath) {
          template.remove();
          return;
        }

        const includeUrl = resolveIncludeUrl(includePath);
        const html = await loadHtmlFragment(includeUrl);
        template.replaceWith(createFragmentFromHtml(html, includeUrl));
      })
    );
  }
}
