// /propose command
// A member runs this to start writing a new resolution.
// Step 1: they see a dropdown of available templates (handled here).
// Step 2: picking one opens a pop-up form (modal) - handled in src/index.js
//         because Discord sends that as a separate "select menu" interaction.

const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../lib/config');
const { isSCMember } = require('../lib/permissions');
const { getAllTemplates, getActiveResolutionsByMember } = require('../lib/resolutions');

module.exports = {
  category: 'Legislation',
  data: new SlashCommandBuilder()
    .setName('propose')
    .setDescription('Start drafting a new resolution from an approved template'),

  async execute(interaction) {
    const config = getConfig();
    const limit = config.maxActiveResolutionsPerMember;

    if (limit > 0) {
      const active = getActiveResolutionsByMember(interaction.user.id);
      if (active.length >= limit) {
        const list = active.map((r) => `**${r.number}** — ${r.title} (${r.status})`).join('\n');
        return interaction.reply({
          content: `❌ You already have ${active.length}/${limit} active resolution(s) — the maximum allowed at once:\n${list}\nYou can propose a new one once one of these is resolved.`,
          ephemeral: true,
        });
      }
    }

    const templates = getAllTemplates().filter((t) => t.enabled);

    const usable = templates.filter((t) => {
      if (t.allowedRole && !interaction.member.roles.cache.has(t.allowedRole)) return false;
      // Security Council (and "Both") resolutions can only be proposed by
      // Security Council members - proposing isn't just about who can
      // vote later, it's who's allowed to bring SC business forward at all.
      if ((t.body === 'SC' || t.body === 'Both') && !isSCMember(interaction.member, config)) return false;
      return true;
    });

    if (usable.length === 0) {
      return interaction.reply({
        content: '❌ There are no resolution templates available to you right now. Ask an administrator to create one with `/template create`.',
        ephemeral: true,
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('propose_select_template')
      .setPlaceholder('Choose a resolution category...')
      .addOptions(
        usable.slice(0, 25).map((t) => {
          const bodyTag = t.body === 'SC' ? '🔒 Security Council' : t.body === 'Both' ? '🔒 GA + SC' : null;
          return {
            label: (bodyTag ? `${t.name} — ${bodyTag}` : t.name).slice(0, 100),
            value: t.name,
            description: `Fields: ${t.fields.join(', ')}`.slice(0, 100),
          };
        })
      );

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
      content: 'Select the type of resolution you want to propose:',
      components: [row],
      ephemeral: true,
    });
  },
};
