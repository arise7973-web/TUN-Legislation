// /resolution command
// Look up resolutions, edit your own before it's been approved, delete
// your own before it's been approved, or (admin only) delete any
// resolution or wipe the entire archive and restart numbering from 001.

const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getConfig } = require('../lib/config');
const { isAdmin } = require('../lib/permissions');
const { getAllResolutions, findResolution, findTemplate, deleteResolution, clearAllResolutions, EDITABLE_STATUSES, SELF_DELETABLE_STATUSES } = require('../lib/resolutions');
const { resolutionEmbed } = require('../lib/embeds');
const { logAudit } = require('../lib/audit');

module.exports = {
  category: 'Legislation',
  data: new SlashCommandBuilder()
    .setName('resolution')
    .setDescription('View, edit, or delete resolutions')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a specific resolution')
        .addStringOption((o) => o.setName('number').setDescription('Resolution number, e.g. UNGA/2026/001').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List the most recent resolutions')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by status')
            .setRequired(false)
            .addChoices(
              { name: 'Draft', value: 'Draft' },
              { name: 'Awaiting Sponsors', value: 'Awaiting Sponsors' },
              { name: 'Under Administrative Review', value: 'Under Administrative Review' },
              { name: 'Returned for Revision', value: 'Returned for Revision' },
              { name: 'Debate', value: 'Debate' },
              { name: 'Voting', value: 'Voting' },
              { name: 'Passed', value: 'Passed' },
              { name: 'Failed', value: 'Failed' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription("Edit your resolution's text (only before it's approved into debate)")
        .addStringOption((o) => o.setName('number').setDescription('Resolution number').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete your own resolution (only before it has been approved into debate)')
        .addStringOption((o) => o.setName('number').setDescription('Resolution number').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin-delete')
        .setDescription('Permanently delete any resolution, regardless of status (admin only)')
        .addStringOption((o) => o.setName('number').setDescription('Resolution number').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin-clear-all')
        .setDescription('Permanently delete ALL resolutions and restart numbering from 001 (admin only)')
        .addBooleanOption((o) => o.setName('confirm').setDescription('Set to True to confirm - this cannot be undone').setRequired(true))
    ),

  async execute(interaction) {
    const config = getConfig();
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const number = interaction.options.getString('number');
      const resolution = findResolution(number);
      if (!resolution) {
        return interaction.reply({ content: `❌ No resolution found with number **${number}**.`, ephemeral: true });
      }
      return interaction.reply({ embeds: [resolutionEmbed(resolution)] });
    }

    if (sub === 'list') {
      const statusFilter = interaction.options.getString('status');
      let list = getAllResolutions();
      if (statusFilter) list = list.filter((r) => r.status === statusFilter);
      list = list.slice(-15).reverse();

      if (list.length === 0) {
        return interaction.reply({ content: 'No resolutions found.', ephemeral: true });
      }

      const lines = list.map((r) => `**${r.number}** — ${r.title.slice(0, 80)} — *${r.status}*`);
      const embed = new EmbedBuilder()
        .setTitle('📋 Recent Resolutions')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n').slice(0, 4000));

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'edit') {
      const number = interaction.options.getString('number');
      const resolution = findResolution(number);
      if (!resolution) {
        return interaction.reply({ content: `❌ No resolution found with number **${number}**.`, ephemeral: true });
      }
      const canEdit = isAdmin(interaction.member, config) || resolution.submittedBy === interaction.user.id;
      if (!canEdit) {
        return interaction.reply({ content: '❌ Only the proposer or an admin can edit this resolution.', ephemeral: true });
      }
      if (!EDITABLE_STATUSES.includes(resolution.status)) {
        return interaction.reply({
          content: `❌ This resolution can no longer be edited (status: ${resolution.status}). Editing is only allowed before a resolution is approved into debate.`,
          ephemeral: true,
        });
      }

      const template = findTemplate(resolution.templateName);
      if (!template) {
        return interaction.reply({ content: '❌ The template this resolution was created from no longer exists, so it can\'t be edited through this form. Ask an admin to help directly.', ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`resedit_modal_${encodeURIComponent(resolution.number)}`)
        .setTitle(`Edit ${resolution.number}`.slice(0, 45));

      for (let i = 0; i < template.fields.length; i++) {
        const fieldName = template.fields[i];
        const input = new TextInputBuilder()
          .setCustomId(`field_${i}`)
          .setLabel(fieldName.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue((resolution.fields[fieldName] || '').toString().slice(0, 4000));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }

      return interaction.showModal(modal);
    }

    if (sub === 'delete') {
      const number = interaction.options.getString('number');
      const resolution = findResolution(number);
      if (!resolution) {
        return interaction.reply({ content: `❌ No resolution found with number **${number}**.`, ephemeral: true });
      }
      if (resolution.submittedBy !== interaction.user.id) {
        return interaction.reply({ content: '❌ You can only delete your own resolutions. An admin can use `/resolution admin-delete` for others.', ephemeral: true });
      }
      if (!SELF_DELETABLE_STATUSES.includes(resolution.status)) {
        return interaction.reply({
          content: `❌ This resolution can no longer be deleted (status: ${resolution.status}). Once a resolution is approved into debate, it stays on the record.`,
          ephemeral: true,
        });
      }

      deleteResolution(number);
      logAudit(interaction.client, 'Resolution Deleted', `**${number}** — ${resolution.title} deleted by its proposer (${interaction.user.tag}).`, resolution.body).catch((err) => console.error(err));
      return interaction.reply({ content: `🗑️ **${number}** has been deleted.`, ephemeral: true });
    }

    if (sub === 'admin-delete') {
      if (!isAdmin(interaction.member, config)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      }
      const number = interaction.options.getString('number');
      const resolution = findResolution(number);
      if (!resolution) {
        return interaction.reply({ content: `❌ No resolution found with number **${number}**.`, ephemeral: true });
      }
      deleteResolution(number);
      logAudit(interaction.client, 'Resolution Deleted', `**${number}** — ${resolution.title} deleted by admin ${interaction.user.tag}.`, resolution.body).catch((err) => console.error(err));
      return interaction.reply({ content: `🗑️ **${number}** has been permanently deleted.`, ephemeral: true });
    }

    if (sub === 'admin-clear-all') {
      if (!isAdmin(interaction.member, config)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      }
      const confirm = interaction.options.getBoolean('confirm');
      if (!confirm) {
        return interaction.reply({
          content: '⚠️ This will permanently delete **every** resolution and restart numbering from 001. This cannot be undone. Run again with `confirm:True` if you\'re sure.',
          ephemeral: true,
        });
      }

      const countBefore = getAllResolutions().length;
      clearAllResolutions(config.resolutionNumbering.prefix);
      logAudit(interaction.client, 'All Resolutions Cleared', `${countBefore} resolution(s) permanently deleted by admin ${interaction.user.tag}. Numbering reset to 001.`).catch((err) => console.error(err));
      return interaction.reply({ content: `🗑️ All ${countBefore} resolution(s) have been permanently deleted, and numbering has been reset to 001.`, ephemeral: true });
    }
  },
};
