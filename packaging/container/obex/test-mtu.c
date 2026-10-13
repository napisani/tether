/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Compile the actual distro-patched session.c, not a copy of its call.
 * Stop immediately after its constructor so no D-Bus/phone is needed;
 * the resulting real GObex is exercised over a local packet socket.
 */
#include <setjmp.h>
#include <sys/socket.h>
#include <glib.h>
#include "gobex/gobex.h"

static jmp_buf constructed;
static GObex *actual_obex;
static GObex *capture_obex(GIOChannel *io, GObexTransportType type,
                         gssize rx_mtu, gssize tx_mtu);
#define g_obex_new capture_obex
#include "obexd/client/session.c"
#undef g_obex_new

static GObex *capture_obex(GIOChannel *io, GObexTransportType type,
                         gssize rx_mtu, gssize tx_mtu)
{
    actual_obex = g_obex_new(io, type, rx_mtu, tx_mtu);
    g_assert_nonnull(actual_obex);
    longjmp(constructed, 1);
}

static int packet_options(GIOChannel *io, int *tx, int *rx)
{
    (void) io;
    *tx = 672;
    *rx = 32767;
    return 0;
}

static ssize_t receive_packet(int fd, guint8 *buf, size_t size)
{
    gint64 deadline = g_get_monotonic_time() + 2 * G_TIME_SPAN_SECOND;
    while (g_get_monotonic_time() < deadline) {
        while (g_main_context_iteration(NULL, FALSE)) {}
        ssize_t len = recv(fd, buf, size, MSG_DONTWAIT);
        if (len >= 0)
            return len;
        g_assert_cmpint(errno, ==, EAGAIN);
        g_usleep(1000);
    }
    g_error("timed out waiting for OBEX packet");
    return -1;
}

static gboolean connected;
static void connect_complete(GObex *obex, GError *err, GObexPacket *rsp,
                             gpointer data)
{
    (void) obex; (void) rsp; (void) data;
    g_assert_no_error(err);
    connected = TRUE;
}

static gssize fill_body(void *buf, gsize len, gpointer data)
{
    (void) data;
    memset(buf, 'x', len);
    return len;
}

/* --wrap=main selects this harness while retaining daemon objects required
 * by session.c. The production daemon's main is never executed.
 */
int __wrap_main(void)
{
    int sockets[2];
    guint8 buf[65535];
    GError *err = NULL;
    struct obc_driver driver = {0};
    struct obc_transport transport = {.getpacketopt = packet_options};
    struct obc_session session = {.driver = &driver, .transport = &transport};
    struct callback_data callback = {.session = &session};
    g_assert_cmpint(socketpair(AF_UNIX, SOCK_SEQPACKET, 0, sockets), ==, 0);
    GIOChannel *io = g_io_channel_unix_new(sockets[0]);
    if (setjmp(constructed) == 0)
        transport_func(io, NULL, &callback);

    g_assert_cmpuint(g_obex_connect(actual_obex, connect_complete, NULL, &err,
                                  G_OBEX_HDR_INVALID), >, 0);
    g_assert_no_error(err);
    ssize_t len = receive_packet(sockets[1], buf, sizeof(buf));
    g_assert_cmpint(len, >=, 7);
    g_assert_cmphex(buf[0], ==, 0x80);
    /* CONNECT must advertise the local RX MTU, not the peer's 672-byte TX cap. */
    g_assert_cmpuint(((guint) buf[5] << 8) | buf[6], ==, 32767);
    g_print("PASS: actual session CONNECT advertises RX MTU 32767 (TX 672)\n");

    /* Peer offers 65535: the local L2CAP TX cap must still win. */
    const guint8 response[] = {0xa0, 0, 7, 0x10, 0, 0xff, 0xff};
    g_assert_cmpint(send(sockets[1], response, sizeof(response), 0), ==,
                    sizeof(response));
    gint64 deadline = g_get_monotonic_time() + 2 * G_TIME_SPAN_SECOND;
    while (!connected && g_get_monotonic_time() < deadline) {
        while (g_main_context_iteration(NULL, FALSE)) {}
        g_usleep(1000);
    }
    g_assert_true(connected);
    GObexPacket *put = g_obex_packet_new(G_OBEX_OP_PUT, FALSE, G_OBEX_HDR_INVALID);
    g_assert_true(g_obex_packet_add_body(put, fill_body, NULL));
    g_assert_true(g_obex_send(actual_obex, put, &err));
    g_assert_no_error(err);
    len = receive_packet(sockets[1], buf, sizeof(buf));
    g_assert_cmpint(len, ==, 672);
    g_assert_cmpuint(((guint) buf[1] << 8) | buf[2], ==, 672);
    g_print("PASS: actual GObex PUT is capped at TX MTU 672 despite peer MTU 65535\n");
    g_obex_unref(actual_obex);
    g_io_channel_unref(io);
    close(sockets[0]);
    close(sockets[1]);
    return 0;
}
