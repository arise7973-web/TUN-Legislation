// /sponsor command
// The proposer of a resolution automatically counts as its first sponsor,
// so this command is only for OTHER members who want to back someone
// else's resolution (or withdraw that backing) before it's approved into
// Debate.

const { SlashCommandBuilder } = require('discord.js');
const { getConfig } = require('../lib/config');
const { isSponsorEligible } = require('../lib/permissions');
const { findResolution, upsertResolution, SELF_DELETABLE_STATUSES } = require('../lib/resolutions');
const { resolutionEmbed } = require('../lib/embeds');
const { logAudit, dmUser } = require('../lib/audit');
const { postToReviewChannels } = require('../lib/voting');

module.exports = {
  category: 'Legislation',
  data: new SlashCommandBuilder()
    .setName('sponsor')
    .setDescription('Add or remove your sponsorship of someone else\'s resolution')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Sponsor a resolution')
        .addStringOption((o) => o.setName('number').setDescription('Resolution number, e.g. UNGA/2026/001').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Withdraw your sponsorship')
        .addStringOption((o) => o.setName('number').setDescription('Resolution number').setRequired(true).setAutocomplete(true))
    ),

  async execute(interaction) {
    const config = getConfig();
    const number = interaction.options.getString('number');
    const resolution = findResolution(number);

    if (!resolution) {
      return interaction.reply({ content: `❌ No resolution found with number **${number}**.`, ephemeral: true });
    }

    // A resolution can be sponsored/un-sponsored any time before it's been
    // approved into Debate - not just during the initial sponsor-collection
    // window, since sponsors might reasonably change their mind while it's
    // still under review or back for revision.
    if (!SELF_DELETABLE_STATUSES.includes(resolution.status)) {
      return interaction.reply({ content: `❌ This resolution has already been approved into debate, so sponsorship can no longer change (status: ${resolution.status}).`, ephemeral: true });
    }

    if (!isSponsorEligible(interaction.member, config)) {
      return interaction.reply({ content: '❌ You are not eligible to sponsor resolutions.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      if (resolution.sponsors.includes(interaction.user.id)) {
        const note = resolution.submittedBy === interaction.user.id ? ' (you were automatically added as its first sponsor when you proposed it)' : '';
        return interaction.reply({ content: `You have already sponsored this resolution${note}.`, ephemeral: true });
      }
      resolution.sponsors.push(interaction.user.id);

      // Only auto-advance out of the sponsor-collection stage - if it's
      // already past that (under review, or back for revision), adding a
      // sponsor doesn't change its stage.
      const reachedThreshold =
        (resolution.status === 'Draft' || resolution.status === 'Awaiting Sponsors') && resolution.sponsors.length >= config.sponsorsRequired;
      if (reachedThreshold) resolution.status = 'Under Administrative Review';
      upsertResolution(resolution);

      await interaction.reply({
        content: `✅ You are now sponsoring **${resolution.number}**. (${resolution.sponsors.length}/${config.sponsorsRequired} sponsors)`,
        embeds: [resolutionEmbed(resolution)],
        ephemeral: true,
      });

      logAudit(interaction.client, 'Sponsor Added', `${interaction.user.tag} sponsored ${resolution.number}.`, resolution.body).catch((err) => console.error(err));

      dmUser(
        interaction.client,
        resolution.submittedBy,
        `📌 **${interaction.user.tag}** has sponsored your resolution **${resolution.number}** (${resolution.sponsors.length}/${config.sponsorsRequired} sponsors).`
      );
      if (reachedThreshold) {
        dmUser(interaction.client, resolution.submittedBy, `✅ Your resolution **${resolution.number}** now has enough sponsors and has moved to Administrative Review.`);
        postToReviewChannels(interaction.client, resolution, config).catch((err) => console.error(err));
      }
      return;
    }

    if (sub === 'remove') {
      if (resolution.submittedBy === interaction.user.id) {
        return interaction.reply({
          content: "❌ As the proposer, you can't remove yourself as a sponsor. Use `/resolution delete` to withdraw the resolution entirely, or `/resolution edit` to change its text.",
          ephemeral: true,
        });
      }
      if (!resolution.sponsors.includes(interaction.user.id)) {
        return interaction.reply({ content: 'You are not currently sponsoring this resolution.', ephemeral: true });
      }
      resolution.sponsors = resolution.sponsors.filter((id) => id !== interaction.user.id);

      // If removing this sponsor drops it back below the threshold while
      // it's still in the sponsor-collection/review stage, send it back to
      // collecting sponsors. Leave "Returned for Revision" alone - that
      // stage is managed by /resolution edit, not sponsor counts.
      if (
        (resolution.status === 'Awaiting Sponsors' || resolution.status === 'Under Administrative Review') &&
        resolution.sponsors.length < config.sponsorsRequired
      ) {
        resolution.status = 'Awaiting Sponsors';
      }
      upsertResolution(resolution);

      await interaction.reply({ content: `✅ You have withdrawn your sponsorship of **${resolution.number}**.`, ephemeral: true });

      logAudit(interaction.client, 'Sponsor Removed', `${interaction.user.tag} withdrew sponsorship of ${resolution.number}.`, resolution.body).catch((err) => console.error(err));
      return;
    }
  },
};
