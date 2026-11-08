// pool.rs: init; two lenders deposit/withdraw; share math; illiquid withdraw rejected.
// Invariant 4 (partial): share price never decreases across deposit/withdraw.
mod common;
use common::*;

fn setup() -> (LiteSVM, Keypair, Keypair, Pubkey, Pubkey, Pubkey) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    let oracle = Keypair::new();
    let (pool, vault, lp) = init_pool(&mut s, &admin, oracle.pubkey());
    (s, admin, oracle, pool, vault, lp)
}

#[test]
fn init_pool_creates_accounts() {
    let (s, admin, _o, pool, vault, lp) = setup();
    let p = pool_state(&s);
    assert_eq!(p.admin, admin.pubkey());
    assert_eq!(p.fee_bps, FEE_BPS);
    assert_eq!(p.ticket_lamports, TICKET);
    assert_eq!(p.lp_mint, lp);
    assert_eq!(p.total_principal, 0);
    // vault is system-owned, zero data, holds exactly rent_min(0)
    let v = s.get_account(&vault).unwrap();
    assert_eq!(v.lamports, RENT_0);
    assert_eq!(v.data.len(), 0);
}

#[test]
fn deposit_and_withdraw_roundtrip() {
    let (mut s, _a, _o, _pool, _v, lp) = setup();
    let l1 = funded(&mut s, 100_000_000_000);
    let l2 = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &l1, 30_000_000_000);
    deposit(&mut s, &l2, 20_000_000_000);

    let ata1 = anchor_spl::associated_token::get_associated_token_address(&l1.pubkey(), &lp);
    let ata2 = anchor_spl::associated_token::get_associated_token_address(&l2.pubkey(), &lp);
    assert_eq!(token_balance(&s, &ata1), 30_000_000_000);
    assert_eq!(token_balance(&s, &ata2), 20_000_000_000);
    assert_eq!(mint_supply(&s, &lp), 50_000_000_000);

    // withdraw all of l2's shares -> gets 20 SOL back (1:1 price)
    let bal_before = s.get_balance(&l2.pubkey()).unwrap();
    withdraw(&mut s, &l2, 20_000_000_000).unwrap();
    let bal_after = s.get_balance(&l2.pubkey()).unwrap();
    assert_eq!(bal_after - bal_before, 20_000_000_000 - 5000); // minus tx fee
    assert_eq!(token_balance(&s, &ata2), 0);
    assert_eq!(mint_supply(&s, &lp), 30_000_000_000);
}

#[test]
fn zero_share_deposit_rejected() {
    let (mut s, _a, _o, _p, _v, lp) = setup();
    let l1 = funded(&mut s, 100_000_000_000);
    let l2 = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &l1, 30_000_000_000);
    // l2 deposits 1 lamport when price is 1:1 -> still 1 share; use a dust amount
    // that floors to 0 only if price > 1 lamport/share; instead try deposit 0.
    let (pool, _) = pool_pda();
    let (vault, _) = vault_pda(&pool);
    let ata = anchor_spl::associated_token::get_associated_token_address(&l2.pubkey(), &lp);
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::Deposit { lamports: 0 }.data(),
        ticketline::accounts::Deposit {
            lender: l2.pubkey(),
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
    let r = send(&mut s, &[&l2], ix);
    assert!(r.is_err(), "zero-lamport deposit must fail");
}

#[test]
fn illiquid_withdraw_rejected() {
    // deposit, lend most of it out via a real top_up, then a full withdraw must fail
    let (mut s, _a, oracle, pool, _v, _lp) = setup();
    let l1 = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &l1, 2_000_000_000); // 2 SOL in vault

    // enrolled position with deficit
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, RENT_3762 + 100));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    top_up(&mut s, &l1, &vote).unwrap();
    let _ = oracle;

    // vault_available now < 2 SOL; withdrawing all shares must fail PoolIlliquid
    let ata = anchor_spl::associated_token::get_associated_token_address(&l1.pubkey(), &_lp);
    let shares = token_balance(&s, &ata);
    let r = withdraw(&mut s, &l1, shares);
    assert!(r.is_err(), "illiquid withdraw should fail: {r:?}");
    let _ = pool;
}

#[test]
fn update_params_admin_only() {
    let (mut s, admin, _o, _p, _v, _lp) = setup();
    let stranger = funded(&mut s, 1_000_000_000);
    let r = update_params(&mut s, &stranger, Some(1_600_000_000));
    assert!(r.is_err(), "non-admin update must fail");
    update_params(&mut s, &admin, Some(1_600_000_000)).unwrap();
    assert_eq!(pool_state(&s).ticket_lamports, 1_600_000_000);
}
