#![allow(dead_code)]
pub use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_vote_interface::state::{
        vote_state_v4::VoteStateV4, vote_state_versions::VoteStateVersions,
    },
};

pub const VOTE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("Vote111111111111111111111111111111111111111");
pub const CLOCK_SYSVAR: Pubkey =
    Pubkey::from_str_const("SysvarC1ock11111111111111111111111111111111");
pub const INCINERATOR: Pubkey =
    Pubkey::from_str_const("1nc1nerator11111111111111111111111111111111");

pub const FEE_BPS: u16 = 150;
pub const TICKET: u64 = 800_000_000;
pub const BUFFER: u64 = 10_000_000;
pub const CREDIT_TICKETS: u8 = 5;
pub const RENT_0: u64 = 890_880;
pub const RENT_3762: u64 = 27_074_400;
pub const SYSTEM_PROGRAM: Pubkey =
    Pubkey::from_str_const("11111111111111111111111111111111");
pub const RENT_SYSVAR: Pubkey =
    Pubkey::from_str_const("SysvarRent111111111111111111111111111111111");

pub fn svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/ticketline.so"));
    svm.add_program(ticketline::id(), bytes).unwrap();
    svm
}

pub fn pool_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pool"], &ticketline::id())
}
pub fn vault_pda(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault", pool.as_ref()], &ticketline::id())
}
pub fn lp_pda(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"lp", pool.as_ref()], &ticketline::id())
}
pub fn pos_pda(vote: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pos", vote.as_ref()], &ticketline::id())
}
pub fn auth_pda(vote: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"auth", vote.as_ref()], &ticketline::id())
}

pub fn send(svm: &mut LiteSVM, signers: &[&Keypair], ix: Instruction) -> Result<(), String> {
    svm.expire_blockhash();
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signers[0].pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

pub fn funded(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), lamports).unwrap();
    k
}

pub struct VoteCfg {
    pub vote: Pubkey,
    pub node: Pubkey,
    pub withdrawer: Pubkey,
    pub collector: Pubkey,
    pub bls: bool,
    pub pending: u64,
    pub lamports: u64,
}

pub fn vote_cfg(vote: Pubkey, node: Pubkey, withdrawer: Pubkey, lamports: u64) -> VoteCfg {
    VoteCfg {
        vote,
        node,
        withdrawer,
        collector: vote,
        bls: true,
        pending: 0,
        lamports,
    }
}

pub fn put_vote_account(svm: &mut LiteSVM, cfg: &VoteCfg) {
    let vs = VoteStateV4 {
        node_pubkey: cfg.node,
        authorized_withdrawer: cfg.withdrawer,
        inflation_rewards_collector: cfg.collector,
        bls_pubkey_compressed: if cfg.bls { Some([0xAA; 48]) } else { None },
        pending_delegator_rewards: cfg.pending,
        ..Default::default()
    };
    let mut data = vec![0u8; VoteStateV4::size_of()];
    VoteStateV4::serialize(&VoteStateVersions::V4(Box::new(vs)), &mut data).unwrap();
    svm.set_account(
        cfg.vote,
        Account {
            lamports: cfg.lamports,
            data,
            owner: VOTE_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn set_vote_lamports(svm: &mut LiteSVM, vote: &Pubkey, lamports: u64) {
    let mut a = svm.get_account(vote).unwrap();
    a.lamports = lamports;
    svm.set_account(*vote, a).unwrap();
}

pub fn vote_lamports(svm: &LiteSVM, vote: &Pubkey) -> u64 {
    svm.get_balance(vote).unwrap()
}

pub fn vote_withdrawer(svm: &LiteSVM, vote: &Pubkey) -> Pubkey {
    let a = svm.get_account(vote).unwrap();
    Pubkey::try_from(&a.data[36..68]).unwrap()
}

pub fn init_pool(svm: &mut LiteSVM, admin: &Keypair, oracle: Pubkey) -> (Pubkey, Pubkey, Pubkey) {
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let (lp, _) = lp_pda(&pool);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::InitPool {
            fee_bps: FEE_BPS,
            ticket_lamports: TICKET,
            buffer_lamports: BUFFER,
            default_credit_tickets: CREDIT_TICKETS,
            oracle,
        }
        .data(),
        ticketline::accounts::InitPool {
            admin: admin.pubkey(),
            pool,
            vault,
            lp_mint: lp,
            token_program: anchor_spl::token::ID,
            system_program: SYSTEM_PROGRAM,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[admin], ix).expect("init_pool");
    (pool, vault, lp)
}

pub fn deposit(svm: &mut LiteSVM, lender: &Keypair, lamports: u64) {
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let (lp, _) = lp_pda(&pool);
    let ata = anchor_spl::associated_token::get_associated_token_address(&lender.pubkey(), &lp);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Deposit { lamports }.data(),
        ticketline::accounts::Deposit {
            lender: lender.pubkey(),
            pool,
            vault,
            lp_mint: lp,
            lender_ata: ata,
            token_program: anchor_spl::token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: SYSTEM_PROGRAM,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[lender], ix).expect("deposit");
}

pub fn withdraw(svm: &mut LiteSVM, lender: &Keypair, shares: u64) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let (lp, _) = lp_pda(&pool);
    let ata = anchor_spl::associated_token::get_associated_token_address(&lender.pubkey(), &lp);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Withdraw { shares }.data(),
        ticketline::accounts::Withdraw {
            lender: lender.pubkey(),
            pool,
            vault,
            lp_mint: lp,
            lender_ata: ata,
            token_program: anchor_spl::token::ID,
            system_program: SYSTEM_PROGRAM,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[lender], ix)
}

pub fn enroll(
    svm: &mut LiteSVM,
    owner: &Keypair,
    vote: &Pubkey,
    payout: Pubkey,
) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (pos, _) = pos_pda(vote);
    let (auth, _) = auth_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Enroll { payout }.data(),
        ticketline::accounts::Enroll {
            owner: owner.pubkey(),
            vote_account: *vote,
            auth,
            position: pos,
            pool,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    );
    send(svm, &[owner], ix)
}

pub fn top_up(svm: &mut LiteSVM, payer: &Keypair, vote: &Pubkey) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let (pos, _) = pos_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::TopUp {}.data(),
        ticketline::accounts::TopUpIx {
            payer: payer.pubkey(),
            pool,
            vault,
            position: pos,
            vote_account: *vote,
            system_program: SYSTEM_PROGRAM,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[payer], ix)
}

pub fn sweep(svm: &mut LiteSVM, payer: &Keypair, vote: &Pubkey) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let (pos, _) = pos_pda(vote);
    let (auth, _) = auth_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Sweep {}.data(),
        ticketline::accounts::SweepIx {
            payer: payer.pubkey(),
            pool,
            vault,
            position: pos,
            vote_account: *vote,
            auth,
            vote_program: VOTE_PROGRAM_ID,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[payer], ix)
}

pub fn withdraw_surplus(
    svm: &mut LiteSVM,
    owner: &Keypair,
    vote: &Pubkey,
    payout: Pubkey,
    lamports: u64,
) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (pos, _) = pos_pda(vote);
    let (auth, _) = auth_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::WithdrawSurplus { lamports }.data(),
        ticketline::accounts::WithdrawSurplus {
            owner: owner.pubkey(),
            pool,
            position: pos,
            vote_account: *vote,
            auth,
            payout,
            vote_program: VOTE_PROGRAM_ID,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(svm, &[owner], ix)
}

pub fn exit_ix(
    svm: &mut LiteSVM,
    owner: &Keypair,
    vote: &Pubkey,
    new_withdrawer: Pubkey,
) -> Result<(), String> {
    let (pos, _) = pos_pda(vote);
    let (auth, _) = auth_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Exit { new_withdrawer }.data(),
        ticketline::accounts::Exit {
            owner: owner.pubkey(),
            position: pos,
            vote_account: *vote,
            auth,
            clock: CLOCK_SYSVAR,
            vote_program: VOTE_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    send(svm, &[owner], ix)
}

pub fn set_credit_limit(
    svm: &mut LiteSVM,
    oracle: &Keypair,
    vote: &Pubkey,
    limit: u64,
) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (pos, _) = pos_pda(vote);
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::SetCreditLimit { limit }.data(),
        ticketline::accounts::SetCreditLimit {
            oracle: oracle.pubkey(),
            pool,
            position: pos,
        }
        .to_account_metas(None),
    );
    send(svm, &[oracle], ix)
}

pub fn update_params(
    svm: &mut LiteSVM,
    admin: &Keypair,
    ticket_lamports: Option<u64>,
) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let ix = Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::UpdateParams {
            fee_bps: None,
            ticket_lamports,
            buffer_lamports: None,
            default_credit_tickets: None,
            oracle: None,
        }
        .data(),
        ticketline::accounts::UpdateParams { admin: admin.pubkey(), pool }.to_account_metas(None),
    );
    send(svm, &[admin], ix)
}

pub fn set_epoch(svm: &mut LiteSVM, epoch: u64) {
    let mut c = svm.get_sysvar::<solana_clock::Clock>();
    c.epoch = epoch;
    svm.set_sysvar(&c);
}

pub fn pool_state(svm: &LiteSVM) -> ticketline::state::Pool {
    let (pool, _) = pool_pda();
    let a = svm.get_account(&pool).unwrap();
    ticketline::state::Pool::try_deserialize(&mut &a.data[..]).unwrap()
}

pub fn position_state(svm: &LiteSVM, vote: &Pubkey) -> ticketline::state::Position {
    let (pos, _) = pos_pda(vote);
    let a = svm.get_account(&pos).unwrap();
    ticketline::state::Position::try_deserialize(&mut &a.data[..]).unwrap()
}

pub fn token_balance(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let a = svm.get_account(ata).unwrap();
    anchor_spl::token::TokenAccount::try_deserialize(&mut &a.data[..])
        .unwrap()
        .amount
}

pub fn mint_supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let a = svm.get_account(mint).unwrap();
    anchor_spl::token::Mint::try_deserialize(&mut &a.data[..]).unwrap().supply
}

pub fn vault_available(svm: &LiteSVM, pool: &Pubkey) -> u64 {
    let (vault, _) = vault_pda(pool);
    svm.get_balance(&vault).unwrap() - RENT_0
}

/// Simulates commission credited to the vote account between epochs.
pub fn credit_commission(svm: &mut LiteSVM, vote: &Pubkey, lamports: u64) {
    set_vote_lamports(svm, vote, vote_lamports(svm, vote) + lamports);
}

/// Simulates the VAT burn: drops ticket_lamports from the vote account.
pub fn burn_ticket(svm: &mut LiteSVM, vote: &Pubkey, lamports: u64) {
    set_vote_lamports(svm, vote, vote_lamports(svm, vote) - lamports);
}
