pub mod constants;
pub mod error;
pub mod instructions;
pub mod spike;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use spike::*;
pub use state::*;

declare_id!("HDbnoeCddu4hK3JzX78TS4RAq6ZVypvqMhXwk7CEbHyq");

#[program]
pub mod ticketline {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        crate::instructions::increment::handle_increment(ctx)
    }

    pub fn spike_withdraw(ctx: Context<SpikeWithdraw>, lamports: u64) -> Result<()> {
        crate::spike::handle_spike_withdraw(ctx, lamports)
    }

    pub fn spike_authorize(ctx: Context<SpikeAuthorize>, new_authority: Pubkey) -> Result<()> {
        crate::spike::handle_spike_authorize(ctx, new_authority)
    }
}
