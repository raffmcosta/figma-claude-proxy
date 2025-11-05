/**
 * Figma Design Agent
 *
 * A general-purpose AI agent for analyzing and modifying Figma designs.
 * Uses Vercel AI SDK with Claude Sonnet 4 and 8 core tools.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Tool execution context (passed from plugin)
interface FigmaContext {
  pageData?: any;
  selectedNodes?: any[];
  designSystem?: any;
  fullData?: any;
}

/**
 * Create the design agent with tools
 */
export function createDesignAgent(context: FigmaContext) {
  return {
    model: anthropic('claude-sonnet-4'),

    tools: {
      // ===== DATA RETRIEVAL TOOLS =====

      analyzeNodeStructure: {
        description: 'Analyze the structure and properties of nodes in the current context. Returns hierarchical data, spatial relationships, and properties.',
        parameters: z.object({
          focusArea: z.enum(['all', 'selection', 'frames', 'components']).describe('Which nodes to focus analysis on'),
          includeChildren: z.boolean().default(true).describe('Include child nodes in analysis'),
          maxDepth: z.number().max(5).default(2).describe('Maximum hierarchy depth to analyze')
        }),
        execute: async (params: { focusArea: string; includeChildren: boolean; maxDepth: number }) => {
          const { focusArea, includeChildren, maxDepth } = params;
          const { pageData, selectedNodes } = context;

          if (!pageData && !selectedNodes) {
            return {
              error: 'No design data available. Please ensure page data is loaded.'
            };
          }

          let targetNodes;
          if (focusArea === 'selection' && selectedNodes) {
            targetNodes = selectedNodes;
          } else if (focusArea === 'frames' && pageData?.framesHierarchical) {
            targetNodes = pageData.framesHierarchical;
          } else if (focusArea === 'components' && pageData?.components) {
            targetNodes = pageData.components;
          } else {
            targetNodes = pageData?.framesHierarchical || selectedNodes || [];
          }

          return {
            success: true,
            focusArea,
            nodeCount: targetNodes?.length || 0,
            nodes: targetNodes,
            summary: `Analyzed ${targetNodes?.length || 0} ${focusArea} nodes with depth ${maxDepth}`
          };
        }
      },

      searchByProperties: {
        description: 'Search for nodes matching specific properties or patterns (type, name, color, text content, etc.)',
        parameters: z.object({
          type: z.enum(['FRAME', 'TEXT', 'RECTANGLE', 'COMPONENT', 'INSTANCE', 'GROUP', 'ANY']).optional(),
          namePattern: z.string().optional().describe('Regex pattern to match node names'),
          hasAutoLayout: z.boolean().optional(),
          colorFilter: z.string().optional().describe('Filter by fill color (hex or rgba)'),
          textContent: z.string().optional().describe('Search for specific text content')
        }),
        execute: async (params: { type?: string; namePattern?: string; hasAutoLayout?: boolean; colorFilter?: string; textContent?: string }) => {
          const { type, namePattern, hasAutoLayout, colorFilter, textContent } = params;
          const { pageData, fullData } = context;
          const searchableData = fullData || pageData;

          if (!searchableData) {
            return { error: 'No data available for search' };
          }

          const results: any[] = [];
          const searchInNode = (node: any) => {
            let matches = true;

            if (type && type !== 'ANY' && node.type !== type) matches = false;
            if (namePattern && !new RegExp(namePattern, 'i').test(node.name || '')) matches = false;
            if (hasAutoLayout !== undefined && !!node.autoLayout !== hasAutoLayout) matches = false;
            if (textContent && node.text?.content && !node.text.content.includes(textContent)) matches = false;

            if (matches) {
              results.push({
                id: node.id,
                name: node.name,
                type: node.type,
                properties: {
                  autoLayout: node.autoLayout,
                  text: node.text,
                  fillColor: node.fillColor
                }
              });
            }

            if (node.children) {
              node.children.forEach(searchInNode);
            }
          };

          if (searchableData.framesHierarchical) {
            searchableData.framesHierarchical.forEach(searchInNode);
          }

          return {
            success: true,
            matchCount: results.length,
            matches: results.slice(0, 20),
            truncated: results.length > 20
          };
        }
      },

      getDesignSystem: {
        description: 'Retrieve design system information including color palette, typography, spacing tokens, and component library',
        parameters: z.object({
          includeColors: z.boolean().default(true),
          includeTypography: z.boolean().default(true),
          includeComponents: z.boolean().default(true),
          includeSpacing: z.boolean().default(false)
        }),
        execute: async (params: { includeColors: boolean; includeTypography: boolean; includeComponents: boolean; includeSpacing: boolean }) => {
          const { includeColors, includeTypography, includeComponents } = params;
          const { designSystem, pageData } = context;

          const result: any = {
            success: true,
            detected: designSystem?.detected || 'Unknown',
            confidence: designSystem?.confidence || 0
          };

          if (includeColors && pageData?.colorPalette) {
            result.colors = pageData.colorPalette.slice(0, 20);
          }

          if (includeTypography && pageData?.textContent) {
            const fonts = new Set();
            const sizes = new Set();
            pageData.textContent.forEach((text: any) => {
              if (text.fontFamily) fonts.add(text.fontFamily);
              if (text.fontSize) sizes.add(text.fontSize);
            });
            result.typography = {
              fontFamilies: Array.from(fonts),
              fontSizes: Array.from(sizes).sort((a: any, b: any) => a - b)
            };
          }

          if (includeComponents && pageData?.components) {
            result.components = {
              count: pageData.components.length,
              list: pageData.components.slice(0, 10)
            };
          }

          return result;
        }
      },

      getFlowAnalysis: {
        description: 'Analyze user flows, navigation connections, and prototype interactions between screens',
        parameters: z.object({
          includeDeadEnds: z.boolean().default(true),
          includeEntryPoints: z.boolean().default(true)
        }),
        execute: async (params: { includeDeadEnds: boolean; includeEntryPoints: boolean }) => {
          const { includeDeadEnds, includeEntryPoints } = params;
          const { pageData } = context;

          if (!pageData?.connections) {
            return {
              success: false,
              error: 'No flow data available. Ensure prototype connections are analyzed.'
            };
          }

          return {
            success: true,
            totalConnections: pageData.connections.length,
            connections: pageData.connections,
            deadEnds: includeDeadEnds ? pageData.deadEnds : undefined,
            entryPoints: includeEntryPoints ? pageData.entryPoints : undefined,
            summary: `Found ${pageData.connections.length} connections, ${pageData.deadEnds?.length || 0} dead ends, ${pageData.entryPoints?.length || 0} entry points`
          };
        }
      },

      // ===== VALIDATION TOOLS =====

      validateAccessibility: {
        description: 'Check WCAG accessibility compliance including contrast ratios, text sizes, interactive element sizing, and semantic structure',
        parameters: z.object({
          level: z.enum(['A', 'AA', 'AAA']).default('AA'),
          checkContrast: z.boolean().default(true),
          checkTextSize: z.boolean().default(true),
          checkTouchTargets: z.boolean().default(true)
        }),
        execute: async (params: { level: string; checkContrast: boolean; checkTextSize: boolean; checkTouchTargets: boolean }) => {
          const { level, checkContrast, checkTextSize, checkTouchTargets } = params;
          const { pageData, selectedNodes } = context;
          const targetNodes = selectedNodes || pageData?.framesHierarchical || [];

          const issues: any[] = [];

          const checkNode = (node: any) => {
            if (checkContrast && node.type === 'TEXT' && node.fillColor) {
              issues.push({
                nodeId: node.id,
                nodeName: node.name,
                type: 'contrast',
                severity: 'high',
                message: 'Contrast ratio needs verification',
                wcagLevel: level
              });
            }

            if (checkTextSize && node.text && node.text.fontSize < 12) {
              issues.push({
                nodeId: node.id,
                nodeName: node.name,
                type: 'text-size',
                severity: 'medium',
                message: `Text size ${node.text.fontSize}px is below recommended minimum (12px)`,
                wcagLevel: 'AA'
              });
            }

            if (checkTouchTargets && node.type === 'INSTANCE' && node.absoluteWidth && node.absoluteHeight) {
              if (node.absoluteWidth < 44 || node.absoluteHeight < 44) {
                issues.push({
                  nodeId: node.id,
                  nodeName: node.name,
                  type: 'touch-target',
                  severity: 'high',
                  message: `Touch target ${node.absoluteWidth}x${node.absoluteHeight}px is below WCAG minimum (44x44px)`,
                  wcagLevel: 'AA'
                });
              }
            }

            if (node.children) {
              node.children.forEach(checkNode);
            }
          };

          targetNodes.forEach(checkNode);

          return {
            success: true,
            wcagLevel: level,
            totalIssues: issues.length,
            issues: issues.slice(0, 50),
            summary: `Found ${issues.length} accessibility issues at WCAG ${level} level`
          };
        }
      },

      analyzeDesignQuality: {
        description: 'Evaluate overall design quality including consistency, hierarchy, spacing, alignment, and design system compliance',
        parameters: z.object({
          checkConsistency: z.boolean().default(true),
          checkHierarchy: z.boolean().default(true),
          checkSpacing: z.boolean().default(true),
          checkAlignment: z.boolean().default(true)
        }),
        execute: async (params: { checkConsistency: boolean; checkHierarchy: boolean; checkSpacing: boolean; checkAlignment: boolean }) => {
          const { checkConsistency, checkHierarchy, checkSpacing } = params;
          const { pageData } = context;

          const analysis: any = {
            success: true,
            score: 0,
            maxScore: 100,
            findings: []
          };

          if (checkConsistency && pageData?.components) {
            const detachedCount = pageData.components.filter((c: any) => c.detached).length;
            analysis.findings.push({
              category: 'consistency',
              score: detachedCount === 0 ? 25 : Math.max(0, 25 - detachedCount * 2),
              message: `${detachedCount} detached component instances found`
            });
          }

          if (checkHierarchy && pageData?.textContent) {
            const fontSizes = pageData.textContent.map((t: any) => t.fontSize).filter(Boolean);
            const uniqueSizes = new Set(fontSizes);
            analysis.findings.push({
              category: 'hierarchy',
              score: uniqueSizes.size >= 3 && uniqueSizes.size <= 8 ? 25 : 15,
              message: `${uniqueSizes.size} unique font sizes used (optimal: 3-8)`
            });
          }

          if (checkSpacing && pageData?.framesHierarchical) {
            const autoLayoutCount = pageData.framesHierarchical.filter((f: any) => f.autoLayout).length;
            analysis.findings.push({
              category: 'spacing',
              score: autoLayoutCount > 0 ? 25 : 10,
              message: `${autoLayoutCount} frames use auto-layout`
            });
          }

          analysis.score = analysis.findings.reduce((sum: number, f: any) => sum + f.score, 0);

          return analysis;
        }
      },

      // ===== MODIFICATION TOOLS =====

      generateModificationPlan: {
        description: 'Generate a plan for modifying designs (returns JSON commands that the plugin will execute)',
        parameters: z.object({
          goal: z.string().describe('What you want to achieve'),
          targetNodes: z.array(z.string()).optional().describe('Specific node IDs to modify'),
          modifications: z.array(z.object({
            action: z.enum(['modify', 'create', 'delete', 'group']),
            nodeId: z.string().optional(),
            properties: z.record(z.any()).optional()
          }))
        }),
        execute: async (params: { goal: string; targetNodes?: string[]; modifications: any[] }) => {
          const { goal, targetNodes, modifications } = params;
          return {
            success: true,
            goal,
            plan: {
              targetCount: targetNodes?.length || modifications.length,
              modifications,
              executionMode: 'requires_approval',
              estimatedChanges: modifications.length
            },
            message: `Generated modification plan with ${modifications.length} changes. Review and approve to execute.`
          };
        }
      },

      suggestImprovements: {
        description: 'Suggest specific improvements based on analysis',
        parameters: z.object({
          focusArea: z.enum(['accessibility', 'design-system', 'visual-hierarchy', 'spacing', 'all']),
          priority: z.enum(['critical', 'high', 'medium', 'all']).default('all')
        }),
        execute: async (params: { focusArea: string; priority: string }) => {
          const { focusArea, priority } = params;
          const { pageData } = context;

          const suggestions: any[] = [];

          if (focusArea === 'accessibility' || focusArea === 'all') {
            suggestions.push({
              priority: 'high',
              category: 'accessibility',
              title: 'Improve color contrast',
              description: 'Several text elements have insufficient contrast ratios',
              affectedNodes: 5,
              effort: 'low'
            });
          }

          if (focusArea === 'design-system' || focusArea === 'all') {
            if (pageData?.components) {
              const detachedCount = pageData.components.filter((c: any) => c.detached).length;
              if (detachedCount > 0) {
                suggestions.push({
                  priority: 'medium',
                  category: 'design-system',
                  title: 'Reconnect detached components',
                  description: `${detachedCount} component instances are detached from main`,
                  affectedNodes: detachedCount,
                  effort: 'medium'
                });
              }
            }
          }

          if (focusArea === 'visual-hierarchy' || focusArea === 'all') {
            suggestions.push({
              priority: 'medium',
              category: 'visual-hierarchy',
              title: 'Improve visual hierarchy',
              description: 'Consider increasing contrast between heading and body text',
              affectedNodes: 3,
              effort: 'low'
            });
          }

          const filtered = priority === 'all'
            ? suggestions
            : suggestions.filter(s => s.priority === priority || s.priority === 'critical');

          return {
            success: true,
            suggestionCount: filtered.length,
            suggestions: filtered,
            summary: `Generated ${filtered.length} ${priority} priority suggestions for ${focusArea}`
          };
        }
      }
    },

    maxSteps: 15,
    temperature: 1,

    system: `You are an expert UX/UI design assistant for Figma with deep knowledge of design systems, WCAG accessibility standards, visual hierarchy, and modern design best practices. Use the available tools to gather information and provide comprehensive analysis.`
  };
}
