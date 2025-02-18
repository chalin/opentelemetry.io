// const { slug } = require("github-slugger");
function slug(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

module.exports = {
  names: ["require-heading-ids"],
  description: "Explicit ID required for headings.",
  tags: ["headings", "IDs"],
  function: function rule(params, onError) {
    const config = params.config || {};
    console.log("Config value:", config);
    console.log(config);
    if (config.rules && config.rules.require-heading-ids === false) {
      return;
    }

    params.lines.forEach((line, index) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.*?)(\s+{#([^}]+)})?$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();
        const existingId = headingMatch[4];

        if (!existingId) {
          const generatedId = slug(headingText);
          const fixedLine = `${headingMatch[1]} ${headingText} {#${generatedId}}`;
          onError({
            lineNumber: index + 1,
            detail: `Heading is missing an explicit ID.`, //  Add {#${generatedId}}
            // fixable: true,
            // fix: (fixer) => fixer.replaceLine(index + 1, fixedLine),
          });
        }
      }
    });
  },
};
