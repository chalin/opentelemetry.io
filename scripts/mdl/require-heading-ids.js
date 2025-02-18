const { slug } = require("github-slugger");

module.exports = {
  names: ["require-heading-ids"],
  description: "Ensure all headings have explicit IDs, adding one if missing.",
  tags: ["headings", "IDs"],
  function: function rule(params, onError) {
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
            detail: `Heading is missing an explicit ID. Adding {#${generatedId}}.`,
            fixable: true,
            fix: (fixer) => fixer.replaceLine(index + 1, fixedLine),
          });
        }
      }
    });
  },
};
