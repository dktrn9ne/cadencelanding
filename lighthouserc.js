// Lighthouse CI budgets (PR 8).
// Script-size budget keeps the analytics layer honest: the measurement layer
// plus vendor snippet must stay under 30KB of script on the page.
// SEO is error severity: the SEO/social package ("PR 6" in the spec) landed
// on main, satisfying the staged-severity flip condition.
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npx serve . -l 4173 --no-clipboard',
      url: ['http://localhost:4173/'],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.90 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.90 }],
        'categories:seo': ['error', { minScore: 0.90 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 30000 }],
        'resource-summary:stylesheet:size': ['warn', { maxNumericValue: 60000 }],
      },
    },
  },
};
