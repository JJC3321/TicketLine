// S1 spike: PDA-signed vote Withdraw + Authorize CPIs against a real V4 vote account.
use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, InstructionData,
        ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_vote_interface::{
        instruction as vote_instruction,
        state::{
            vote_state_v4::VoteStateV4, vote_state_versions::VoteStateVersions, VoteAuthorize,
        },
    },
};

const VOTE_PROGRAM_ID: Pubkey = Pubkey::from_str_const("Vote111111111111111111111111111111111111111");
const RENT_3762: u64 = 19_761_200;

fn send(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(msg),
        &[payer],
    )
    .unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

// fixed-offset V4 header parser (mirrors plan section 5.1)
struct V4Header {
    node: Pubkey,
    withdrawer: Pubkey,
    collector: Pubkey,
    pending: u64,
    bls: Option<[u8; 48]>,
}
fn parse_v4(d: &[u8]) -> V4Header {
    assert_eq!(u32::from_le_bytes(d[0..4].try_into().unwrap()), 3);
    assert!(d.len() >= 145);
    V4Header {
        node: Pubkey::try_from(&d[4..36]).unwrap(),
        withdrawer: Pubkey::try_from(&d[36..68]).unwrap(),
        collector: Pubkey::try_from(&d[68..100]).unwrap(),
        pending: u64::from_le_bytes(d[136..144].try_into().unwrap()),
        bls: if d[144] == 1 { Some(d[145..193].try_into().unwrap()) } else { None },
    }
}

#[test]
fn spike_withdraw_and_authorize() {
    let program_id = ticketline::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/ticketline.so"));
    svm.add_program(program_id, bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let vote_pk = Pubkey::new_unique();
    let node = Pubkey::new_unique();
    let (auth, _bump) = Pubkey::find_program_address(&[b"auth", vote_pk.as_ref()], &program_id);
    let pending = 5_000_000u64;
    let start_lamports = 2_000_000_000u64;

    let vs = VoteStateV4 {
        node_pubkey: node,
        authorized_withdrawer: auth,
        inflation_rewards_collector: vote_pk,
        bls_pubkey_compressed: Some([0xAA; 48]),
        pending_delegator_rewards: pending,
        ..Default::default()
    };
    let mut data = vec![0u8; VoteStateV4::size_of()];
    VoteStateV4::serialize(&VoteStateVersions::V4(Box::new(vs)), &mut data).unwrap();
    svm.set_account(
        vote_pk,
        Account { lamports: start_lamports, data, owner: VOTE_PROGRAM_ID, executable: false, rent_epoch: 0 },
    )
    .unwrap();

    // --- encoding check: hand-built bytes vs solana-vote-interface builders ---
    let ref_w = vote_instruction::withdraw(&vote_pk, &auth, 123_456_789, &Pubkey::new_unique());
    let mut hand_w = vec![3u8, 0, 0, 0];
    hand_w.extend_from_slice(&123_456_789u64.to_le_bytes());
    assert_eq!(ref_w.data, hand_w, "withdraw encoding mismatch");

    let new_auth = Pubkey::new_unique();
    let ref_a = vote_instruction::authorize(&vote_pk, &auth, &new_auth, VoteAuthorize::Withdrawer);
    let mut hand_a = vec![1u8, 0, 0, 0];
    hand_a.extend_from_slice(new_auth.as_ref());
    hand_a.extend_from_slice(&1u32.to_le_bytes());
    assert_eq!(ref_a.data, hand_a, "authorize encoding mismatch");

    // --- withdraw: move lamports within allowed headroom ---
    let recipient = Pubkey::new_unique();
    let amount = 500_000_000u64;
    let ix = Instruction::new_with_bytes(
        program_id,
        &ticketline::instruction::SpikeWithdraw { lamports: amount }.data(),
        ticketline::accounts::SpikeWithdraw {
            vote_account: vote_pk,
            recipient,
            auth,
            vote_program: VOTE_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &payer, ix).expect("spike_withdraw failed");
    assert_eq!(svm.get_balance(&recipient).unwrap(), amount);
    assert_eq!(svm.get_balance(&vote_pk).unwrap(), start_lamports - amount);

    // --- withdraw into pending+rent reserve must fail ---
    let cur = svm.get_balance(&vote_pk).unwrap();
    let too_much = cur - (RENT_3762 + pending) + 1;
    let ix = Instruction::new_with_bytes(
        program_id,
        &ticketline::instruction::SpikeWithdraw { lamports: too_much }.data(),
        ticketline::accounts::SpikeWithdraw {
            vote_account: vote_pk,
            recipient,
            auth,
            vote_program: VOTE_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    let err = send(&mut svm, &payer, ix);
    assert!(err.is_err(), "withdraw into pending+rent should fail");

    // --- authorize: change withdrawer via PDA ---
    let ix = Instruction::new_with_bytes(
        program_id,
        &ticketline::instruction::SpikeAuthorize { new_authority: new_auth }.data(),
        ticketline::accounts::SpikeAuthorize {
            vote_account: vote_pk,
            auth,
            clock: solana_sdk_ids::sysvar::clock::id(),
            vote_program: VOTE_PROGRAM_ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &payer, ix).expect("spike_authorize failed");

    // --- re-deserialize via fixed offsets + crate cross-check ---
    let acct = svm.get_account(&vote_pk).unwrap();
    let h = parse_v4(&acct.data);
    assert_eq!(h.node, node);
    assert_eq!(h.withdrawer, new_auth);
    assert_eq!(h.collector, vote_pk);
    assert_eq!(h.pending, pending);
    assert_eq!(h.bls, Some([0xAA; 48]));

    let vs = VoteStateVersions::deserialize(&acct.data).unwrap();
    let VoteStateVersions::V4(v4) = vs else { panic!("not V4") };
    assert_eq!(v4.authorized_withdrawer, new_auth);
    assert_eq!(v4.pending_delegator_rewards, pending);
    assert_eq!(v4.bls_pubkey_compressed, Some([0xAA; 48]));
}
