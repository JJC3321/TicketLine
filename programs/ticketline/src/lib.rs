pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod vote;

use anchor_lang::prelude::*;

pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("HDbnoeCddu4hK3JzX78TS4RAq6ZVypvqMhXwk7CEbHyq");

#[program]
pub mod ticketline {
    use super::*;

    pub fn init_pool(
        ctx: Context<InitPool>,
        fee_bps: u16,
        ticket_lamports: u64,
        buffer_lamports: u64,
        default_credit_tickets: u8,
        oracle: Pubkey,
    ) -> Result<()> {
        crate::instructions::init_pool::handle_init_pool(
            ctx,
            fee_bps,
            ticket_lamports,
            buffer_lamports,
            default_credit_tickets,
            oracle,
        )
    }

    pub fn update_params(
        ctx: Context<UpdateParams>,
        fee_bps: Option<u16>,
        ticket_lamports: Option<u64>,
        buffer_lamports: Option<u64>,
        default_credit_tickets: Option<u8>,
        oracle: Option<Pubkey>,
    ) -> Result<()> {
        crate::instructions::update_params::handle_update_params(
            ctx,
            fee_bps,
            ticket_lamports,
            buffer_lamports,
            default_credit_tickets,
            oracle,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, lamports)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, shares)
    }

    pub fn enroll(ctx: Context<Enroll>, payout: Pubkey) -> Result<()> {
        crate::instructions::enroll::handle_enroll(ctx, payout)
    }

    pub fn set_credit_limit(ctx: Context<SetCreditLimit>, limit: u64) -> Result<()> {
        crate::instructions::set_credit_limit::handle_set_credit_limit(ctx, limit)
    }

    pub fn top_up(ctx: Context<TopUpIx>) -> Result<()> {
        crate::instructions::top_up::handle_top_up(ctx)
    }

    pub fn sweep(ctx: Context<SweepIx>) -> Result<()> {
        crate::instructions::sweep::handle_sweep(ctx)
    }

    pub fn withdraw_surplus(ctx: Context<WithdrawSurplus>, lamports: u64) -> Result<()> {
        crate::instructions::withdraw_surplus::handle_withdraw_surplus(ctx, lamports)
    }

    pub fn exit(ctx: Context<Exit>, new_withdrawer: Pubkey) -> Result<()> {
        crate::instructions::exit::handle_exit(ctx, new_withdrawer)
    }

    #[cfg(feature = "demo-sim")]
    pub fn sim_ticket_burn(ctx: Context<SimTicketBurnIx>) -> Result<()> {
        crate::instructions::sim::handle_sim_ticket_burn(ctx)
    }
}
